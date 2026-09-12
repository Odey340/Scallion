-- daily_connection: distinct people exchanged with per day (docs/contracts.md section 2).
-- Continuous aggregates cannot be created inside a transaction: apply.py runs in autocommit.
create materialized view if not exists daily_connection
with (timescaledb.continuous) as
  select user_id, time_bucket('1 day', ts) as d, count(distinct contact_hash) as people
  from contact_events
  group by 1, 2
with no data;

-- Materialize hourly; anything newer than the end offset is computed live on read
-- (real-time aggregation is on by default), so today's rows show up immediately.
select add_continuous_aggregate_policy('daily_connection',
  start_offset      => interval '400 days',
  end_offset        => interval '1 hour',
  schedule_interval => interval '1 hour',
  if_not_exists     => true);
