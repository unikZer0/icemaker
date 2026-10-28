# AACC IceMaker CloudMeter

Local dashboard for a LEAFTECH CloudMeter-1, with USB and Wi-Fi MQTT inputs.

## Machines and login

Open **http://localhost:3100/machines** to add ice makers, edit their setup, and open each machine's dashboard. Sign in using `ADMIN_USER` / `ADMIN_PASSWORD` in `.env`. If upgrading, run `node scripts/setup-env.js` to add login settings while preserving existing device tokens. Your original CloudMeter and history become the first machine.

Each new machine gets separate Wi-Fi and USB gateway tokens. Its setup page provides the broker details and a downloadable gateway configuration. See [CLOUD.md](CLOUD.md) for multiple-machine setup, USB gateways, and the HTTPS/TLS cloud Compose overlay. The local program has been updated; a public cloud server has not been provisioned.

Devices provides a Delete button with a confirmation dialog requiring the exact device name. Deletion sets `devices.deleted_at`, removes the device from active lists, disconnects its MQTT clients and revokes both tokens for future authentication. Readings and event records remain in PostgreSQL; related active alarms close on the next evaluation. Deleted devices are not recreated or assigned to another device on restart. Deleting an original local USB device also disconnects its native serial reader. To use a replacement device, register it and configure its newly generated tokens.

## Workspace and LINE notifications

The sidebar provides Home (`/home`), Alarms (`/alarms`), Dashboards (`/dashboards`), Devices (`/devices`), and Notification center (`/notifications`). Existing `/machines` and individual machine dashboards remain available.

Notification center configures LINE Messaging API push messages using a channel access token and a recipient user/group/room ID. Save settings before testing. The test button sends a real message to the saved recipient; API acceptance does not guarantee delivery. The bot must be allowed to message that recipient and have sufficient quota. See the [LINE sending guide](https://developers.line.biz/en/docs/messaging-api/sending-messages/).

Automatic notifications start disabled. Select offline, temperature sensor unavailable, and/or tank full. Offline alarms begin only after a machine has reported during the current server session. Freshness expires after 90 seconds; sensor alarms require fresh sensor status, and missing sensor data does not count as recovery. Events are evaluated every five seconds. Acknowledging an event does not resolve the underlying condition. Repeated reports do not create repeated alarms; failed LINE calls retry at most once per minute with the same retry key.

Alarms default to the critical severity filter: offline and failed temperature sensor events are critical, while tank full is informational. Choose all levels to see every event. Notification center also provides optional global critical limits for water temperature, AC voltage, compressor current, and compressor power. Each metric supports a lower and/or upper bound and a confirmation duration (0–3600 seconds, checked every five seconds). All numeric limits start disabled and unset; configure them using verified device units and machine specifications. A failed/unknown temperature sensor cannot trigger numeric temperature alarms. Missing/stale data does not resolve numeric alarms. Returning within the configured bounds resolves them; disabling or changing a rule closes its prior event. LINE messages include severity, the detected value, and the threshold when enabled.

Settings and alarms persist in PostgreSQL. Device and LINE tokens are encrypted with AES-256-GCM using `DATA_ENCRYPTION_KEY`; tokens are decrypted only in the server and never returned by the notification settings API. Active alarms and the latest 500 resolved events are retained. No LINE credentials are provided by this project; actual delivery requires your LINE account configuration.

## PostgreSQL storage and migration

Compose runs PostgreSQL 17 on the private service `database:5432`, with no published database port. Persistent data lives in the `icemaker2_postgres-data` volume, mounted at `/var/lib/postgresql/data` in the database container. Tables are `devices`, `readings`, `alarms`, `alert_rules`, `notification_channels`, `users`, and `schema_migrations`. History queries use indexed device/source/timestamp columns. Single-administrator and single-app-replica behavior remains supported.

Run `node scripts/setup-env.js` before starting Compose. It adds a random database password and encryption key without replacing existing credentials. On the first database startup, the app imports `machines.json`, `readings.ndjson`, and `notifications.json` from the mounted legacy `DATA_DIR` in one transaction. Existing device/event IDs, names, tokens, and timestamps are preserved. `schema_migrations` prevents duplicate imports on restart. A failed import rolls back and the app does not start with empty replacement data. A malformed unfinished final NDJSON record is ignored; invalid completed lines stop migration. Keep the old volume and back it up before upgrading. Native `./data` and the Docker legacy volume are separate sources; only the selected `DATA_DIR` is imported.

After migration the app reads/writes PostgreSQL, leaving the old JSON/NDJSON files unchanged as a migration snapshot. The original administrator is seeded from `ADMIN_USER`/`ADMIN_PASSWORD` once per username; its password is stored as a salted scrypt hash. Changing only `ADMIN_PASSWORD` in `.env` does not reset an already-created database account. In-memory sessions still expire on restart. Original machine MQTT/USB credentials remain environment-managed; other device tokens are encrypted in PostgreSQL.

Back up from Ubuntu/WSL:

```sh
bash scripts/backup-database.sh
```

Backups are custom-format `pg_dump` files under gitignored `data/backups/`. Keep `.env`, especially the original `DATA_ENCRYPTION_KEY`, securely with your backups; encrypted tokens cannot be recovered without that key. The database volume alone is not a backup. Restore into a separate empty database for verification before replacing a live database:

```sh
docker compose exec -T database sh -c 'createdb -U "$POSTGRES_USER" icemaker_restore'
docker compose exec -T database sh -c 'pg_restore -U "$POSTGRES_USER" -d icemaker_restore --exit-on-error' < data/backups/postgres-TIMESTAMP.dump
```

The health endpoint reports `storage: "postgresql"` and returns HTTP 503 when the database is unavailable. It never silently falls back to files after a database failure. `STORAGE_BACKEND=files` is an explicit compatibility mode for isolated local tests/legacy recovery; Compose always selects PostgreSQL. Do not use the frozen legacy files as a current backup after new PostgreSQL writes.

## Runtime configuration

All runtime settings and credentials are in `.env` (gitignored). `.env.example` is the shareable template. The generated device token preserves the previous local token; the USB agent has a separate token. Do not share your real `.env`.

On a fresh checkout, generate it with:

```powershell
node scripts/setup-env.js
```

Check `MQTT_ADVERTISED_HOST`: it must be the Windows PC's IPv4 address on the same network as the CloudMeter. Container addresses are not suitable. Change `PORT`, `MQTT_PORT`, `SERIAL_PORT` and `SERIAL_BAUD` in `.env` as needed. After changing service settings, run `docker compose up -d` again. Restart the USB agent after changing its settings.

## Run with Docker Compose

From a terminal with Docker installed:

```sh
docker compose up -d --build
docker compose ps
docker compose logs -f icemaker
```

On this machine Docker runs in Ubuntu WSL. In Ubuntu:

```sh
cd /mnt/e/works/icemaker2
docker compose up -d --build
```

The existing Snap Docker engine on this machine timed out while opening a BuildKit session. Its working build command is:

```sh
DOCKER_BUILDKIT=0 docker compose up -d --build
```

After the image has been built, ordinary restarts need only `docker compose up -d`.

**Keep a WSL terminal open while using this machine's service.** The WSL VM stops when its last foreground session exits, interrupting Docker even with a restart policy. Run `docker compose up` in Ubuntu and leave it open, or run `./start.ps1` in Windows PowerShell. This helper builds/starts Compose and keeps the WSL session in the foreground. Ctrl+C stops the foreground service. Docker Desktop is not required for this machine's existing setup.

Open **http://localhost:3100** (or the `PORT` set in `.env`). This uses the separate Compose project `icemaker2`. Current records are in `icemaker2_postgres-data`; `icemaker2_icemaker-data` remains the legacy import source. Existing native `data/` history is not automatically copied into that legacy volume.

Stop while preserving history:

```sh
docker compose down
```

Do not add `--volumes` if you want to keep data. The image excludes `.env`, tests, local data and `node_modules`. Compose injects `.env` at runtime. The service health check verifies the MQTT listener and PostgreSQL connectivity.

## USB on Windows while the service runs in Docker

Linux containers cannot directly open Windows COM11. Keep the service in Docker and run the small USB agent on Windows:

```powershell
cd E:\works\icemaker2
npm ci
npm run usb
```

Set `SERIAL_PORT=COM11`, `SERIAL_BAUD=115200` and `BRIDGE_MQTT_HOST=127.0.0.1` in `.env`. The agent uses `MQTT_PORT` and `USB_BRIDGE_TOKEN` from the same file. Keep its terminal open; Ctrl+C stops it. Close the old USB bridge or any serial monitor first. It retries disconnected USB automatically.

USB port controls in the dashboard are disabled in Docker mode because the agent manages the port. Its connection, byte count and parsed report count appear in the dashboard. USB readings retain the USB source; they are not labelled Wi-Fi just because the agent transports them over MQTT.

If Docker runs only inside WSL and the Windows agent cannot reach `127.0.0.1`, check WSL localhost forwarding or set `BRIDGE_MQTT_HOST` to the reachable WSL IPv4 address. Windows/Wi-Fi access to the WSL listener may require firewall/forwarding settings. This project does not change those system settings.

## Direct Wi-Fi

In the CloudMeter's existing configuration interface, set the MQTT host to `MQTT_ADVERTISED_HOST`, port to `MQTT_PORT` (default 1884), and username to `MQTT_TOKEN`; password empty. You can view the device token in the dashboard. Use its existing firmware topics:

```text
v1/devices/me/telemetry
v1/devices/me/attributes
```

The device's configuration interface and ability to change broker settings are still unverified. The app does not reconfigure firmware or Wi-Fi credentials. Direct Wi-Fi requires those device settings to be configurable. Keep the device and PC on the same network; the plain-TCP MQTT port must be reachable from that network. Allow it on your private network if needed. Only the MQTT listener is published on network interfaces; the dashboard is published on localhost.

## Run without Docker

```powershell
npm ci
npm start
```

`npm start` loads `.env` automatically. PostgreSQL mode requires an independently reachable database configured with `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD` (the latter three default to `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`). Compose's database is intentionally not published to the host. For legacy file-only development explicitly set `STORAGE_BACKEND=files`. Native mode (`USB_MODE=local`) enables the dashboard USB selector. Do not run native server and Compose on the same ports simultaneously. Do not run the USB agent and native USB connection against the same COM port.

## Data behavior

Auto mode prefers fresh Wi-Fi reports and falls back to USB; sources and history are separate. Fields expire after 90 seconds or immediately on disconnect. A fresh false temperature-sensor status makes the temperature unavailable. No unit conversions, capacity estimates or synthetic readings are added. Charts use Bangkok time and PC receipt timestamps. History keeps the last 24 hours, up to 100,000 reports, compacted hourly.

Only allowlisted device fields are stored; raw serial output and credentials in payloads are discarded. USB reads the existing firmware's `[TB] Sending data to server over topic (...) with data ({...})` debug output at 115200 baud. A port connection is not proof of incoming sensor reports.

## Development tests

The `test/` folder verifies protocol parsing, MQTT authentication, history and the USB agent transport using temporary data and random loopback ports. These tests are optional development checks, excluded from the Docker image, and never generate readings in your real dashboard.

```powershell
npm test
npm run check
```

Real PostgreSQL integration tests use temporary isolated schemas, then remove only those schemas:

```sh
docker compose run --rm --no-deps -e TEST_POSTGRES=1 -v "$PWD/test:/app/test:ro" --entrypoint node icemaker --test test/database.test.js
```

These cover one-time import, rollback/retry, encrypted tokens, hashed login, API changes, MQTT writes, source isolation, restart persistence, and unchanged legacy source files. The default `npm test` skips database-dependent cases when `TEST_POSTGRES` is unset.
