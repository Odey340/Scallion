-- Tiger Cloud's TimescaleDB defaults continuous aggregates to materialized_only = true, so rows newer
-- than the last refresh were invisible. Turn real-time aggregation on: today's exchanges count today.
alter materialized view if exists daily_connection set (timescaledb.materialized_only = false);
