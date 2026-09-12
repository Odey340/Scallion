-- contact_events: one row per message metadata event (docs/contracts.md section 2).
-- Only {contact_hash, ts, app, dir, len_bucket} ever leaves the device; no content, no handles.
create extension if not exists timescaledb;

create table if not exists contact_events (
  user_id      uuid        not null,
  ts           timestamptz not null,
  contact_hash text        not null,                 -- sha256(normalized handle + user salt)
  app          text        not null check (app in ('gmail', 'whatsapp', 'sms', 'imessage', 'notif')),
  dir          text        not null check (dir in ('in', 'out')),
  len_bucket   smallint    not null check (len_bucket between 0 and 3)  -- <20, <100, <500, more chars
);

select create_hypertable('contact_events', 'ts', if_not_exists => true);

-- Idempotent uploads: B's /events batch can be re-sent after a flaky connection.
create unique index if not exists contact_events_dedup
  on contact_events (user_id, contact_hash, ts, app, dir);

create index if not exists contact_events_user_ts
  on contact_events (user_id, ts desc);
