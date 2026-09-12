-- checkins: the coach's memory (Backboard fallback per the cut order: a Postgres table).
-- Every nudge, reply, logged meal, share and daily check-in lands here so "same plan as
-- yesterday?" is answerable from the last few rows.
create table if not exists checkins (
  id       bigserial   primary key,
  user_id  uuid        not null,
  ts       timestamptz not null default now(),
  kind     text        not null check (kind in ('checkin', 'nudge', 'reply', 'meal', 'share', 'plan')),
  text     text,
  data     jsonb
);

create index if not exists checkins_user_ts on checkins (user_id, ts desc);
