-- Onboarding answers (medication question, sleep, the two LSNS-6 items, bedtime) live with the
-- profile as jsonb so the coach context and the risk-years levers can read them in one query.
alter table profiles add column if not exists answers jsonb not null default '{}'::jsonb;
