-- vitals: one row per Presage capture (docs/contracts.md section 3, POST /vitals).
-- The contract payload is {source, pulse_bpm, breathing_bpm, stress_index, captured_at};
-- the remaining columns are optional extras the worker may send.
create table if not exists vitals (
  user_id       uuid        not null,
  captured_at   timestamptz not null,
  received_at   timestamptz not null default now(),
  source        text        not null default 'presage' check (source in ('presage', 'manual')),
  pulse_bpm     real,
  breathing_bpm real,
  stress_index  real,                -- Baevsky stress index from the SDK's HRV block
  hrv_rmssd_ms  real,                -- exploratory; last in the cut order
  confidence    real check (confidence is null or (confidence between 0 and 1)),
  samples       integer
);

select create_hypertable('vitals', 'captured_at', if_not_exists => true);

create index if not exists vitals_user_captured
  on vitals (user_id, captured_at desc);
