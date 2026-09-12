-- clock_history: every age number shown to a user, with the inputs that produced it.
-- years always comes from a MATLAB export (phenoage, hunt, risk_years) or the social package;
-- the API stores, it never computes (CLAUDE.md rule 1).
create table if not exists clock_history (
  user_id           uuid        not null,
  computed_at       timestamptz not null default now(),
  clock             text        not null check (clock in ('phenoage', 'fitness', 'social_risk')),
  years             real        not null,   -- biological / fitness age, or risk-equivalent years
  chronological_age real,
  band              real,                   -- +/- uncertainty in years, null for social_risk
  inputs            jsonb,                  -- analyte values, vitals, or the metrics snapshot
  engine_version    text                    -- version field of the engine JSON used
);

select create_hypertable('clock_history', 'computed_at', if_not_exists => true);

create index if not exists clock_history_user_clock
  on clock_history (user_id, clock, computed_at desc);
