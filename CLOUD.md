# Cloud hosting and multiple machines

The program has an admin login, a Machines page, per-machine setup, separate Wi-Fi/USB credentials, and per-machine readings/history. It is a single administrator workspace for a small fleet.

## Local setup

Run `node scripts/setup-env.js` after updating. It adds missing login settings without replacing existing tokens. Sign in using `ADMIN_USER` and `ADMIN_PASSWORD` from the server `.env`. The existing CloudMeter and its history become the first machine.

On **Machines**, click **Add machine**, enter name/location, select Wi-Fi or USB, then **Create machine**. Setup shows the generated identity and tokens. **Open dashboard** displays that machine's readings; the dashboard selector switches between machines. You can edit name/location/connection preference without changing credentials. Registration starts with no readings; only an authenticated physical device or gateway populates the dashboard. Both input methods remain supported regardless of the installation preference.

## Cloud server

No cloud server or domain has been provisioned automatically. To deploy:

1. Copy the project to a Linux server with Docker Compose 2.24.4 or later. Generate server `.env` with `node scripts/setup-env.js`, or copy your current `.env` securely to retain the original tokens. Also migrate the Docker data volume if preserving existing fleet records/history.
2. Point a domain such as `ice.example.com` to the server. Set `APP_DOMAIN=ice.example.com`, `AUTH_ENABLED=true`, a strong `ADMIN_PASSWORD`, and `APP_ORIGIN=https://ice.example.com` in `.env`.
3. Supply a valid MQTT certificate and key for that domain as `certs/fullchain.pem` and `certs/privkey.pem`. Ensure container UID 1000 can read them without making the private key public. Recreate the app after certificate renewal. Caddy separately obtains/renews HTTPS certificates for the dashboard.
4. Allow inbound TCP 80/443 for the website and 8883 for encrypted MQTT. The cloud overlay removes the public unencrypted 1884 mapping.
5. Run:

```sh
docker compose -f compose.yaml -f compose.cloud.yaml up -d --build
docker compose -f compose.yaml -f compose.cloud.yaml ps
```

Open `https://ice.example.com`, sign in, and add your machines. The overlay sets the canonical HTTPS origin and advertised TLS broker using `APP_DOMAIN`. Use both Compose files for subsequent operations. Keep the PostgreSQL data volume. Securely back up `.env` (including the original `DATA_ENCRYPTION_KEY`), certificates, and a PostgreSQL `pg_dump` from the `database` service. Current application data is in `icemaker2_postgres-data`; the older `icemaker2_icemaker-data` volume is retained only as the one-time legacy import source. See README for backup/restore and migration details.

## Connect each machine

**Wi-Fi:** Set the broker hostname shown in setup, TLS MQTT port 8883, and that machine's **device token** as MQTT username; password empty. Firmware must support a configurable broker, MQTT over TLS and the certificate trust chain. CloudMeter firmware support remains unverified. If it cannot use TLS, use a USB gateway or a separately managed private network. The cloud overlay does not expose a public unencrypted MQTT port.

**USB:** Download `machine.env` from that machine's setup page. Put it in the project directory on the local computer connected to the ice maker. Set the correct `SERIAL_PORT`, install Node dependencies, then run:

```powershell
node --env-file=machine.env scripts/usb-bridge.js
```

The download includes its USB token and broker settings, never the administrator password. For multiple machines on one PC, use a separate env file and agent process for each COM port. Agent client IDs derive from the assigned tokens. If using a private certificate authority, set `BRIDGE_TLS_CA` to its CA certificate file on the gateway. TLS certificate verification remains enabled.

Topics remain `v1/devices/me/telemetry` and `v1/devices/me/attributes`. The broker identifies machines from credentials; a payload cannot choose a different machine ID. Subscriptions to device data are denied.

Setup generates connection instructions; it does not push Wi-Fi/MQTT configuration into the physical CloudMeter. Use the device's existing configuration interface or vendor firmware tools.

## Limits and verification

- One admin account and one server replica. In-memory sessions expire after 12 hours and after restart. Cookies are HttpOnly/SameSite and Secure in cloud mode; sign-in attempts are rate-limited.
- PostgreSQL storage on a private Docker volume; registry maximum 100 machines. Intended use is a small fleet with one app replica; runtime connection state and login sessions remain in memory.
- History keeps 24 hours and up to 100,000 reports total across the workspace. APIs filter by machine and source. Old untagged records migrate only to the original machine.
- Native USB buttons apply to the original local machine. Docker/cloud USB machines use gateway agents.
- Tests cover login/logout, rate limiting, registration/editing, migration, credential-based routing, separate USB/Wi-Fi histories and persistence. Cloud DNS/certificates and the physical device's TLS support need verification on deployment.
