CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS devices (
  id text PRIMARY KEY,
  name text NOT NULL,
  location text NOT NULL DEFAULT '',
  connection text NOT NULL CHECK (connection IN ('usb', 'wifi')),
  created_at bigint NOT NULL,
  ordinal integer NOT NULL,
  device_token text NOT NULL,
  bridge_token text NOT NULL
);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS deleted_at bigint;
CREATE TABLE IF NOT EXISTS readings (
  id bigserial PRIMARY KEY,
  device_id text NOT NULL REFERENCES devices(id),
  ts bigint NOT NULL,
  source text NOT NULL CHECK (source IN ('usb', 'wifi')),
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS readings_device_source_time ON readings(device_id, source, ts, id);
CREATE INDEX IF NOT EXISTS readings_time ON readings(ts, id);
CREATE TABLE IF NOT EXISTS alarms (
  id text PRIMARY KEY,
  device_id text NOT NULL REFERENCES devices(id),
  machine_name text NOT NULL,
  rule text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('critical', 'info')),
  message text NOT NULL,
  created_at bigint NOT NULL,
  resolved_at bigint,
  details jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS alarms_active_time ON alarms(resolved_at, created_at DESC);
CREATE TABLE IF NOT EXISTS alert_rules (
  name text PRIMARY KEY,
  config jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS notification_channels (
  id text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  recipient text NOT NULL DEFAULT '',
  token_encrypted text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS users (
  username text PRIMARY KEY,
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
