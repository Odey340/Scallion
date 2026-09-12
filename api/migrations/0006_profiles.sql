-- profiles: one row per user. verified/birthdate come from the Persona webhook (never from the
-- client); lang from onboarding. over_65 is derived at read time, never stored.
create table if not exists profiles (
  user_id     uuid        primary key,
  verified    boolean     not null default false,
  birthdate   date,
  lang        text        not null default 'en' check (lang in ('en', 'es')),
  inquiry_id  text,
  updated_at  timestamptz not null default now()
);
