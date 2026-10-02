-- Records which automation run each assessment run request started, so the
-- dashboard can follow that run and its dashboard sync. Safe to run on a fresh
-- install, whose baseline already has the column. See
-- docs/database-maintenance.md#run-id-on-run-requests-0036.

alter table assessment_run_requests add column if not exists run_id text;

comment on column assessment_run_requests.run_id is
  'The automation run the worker started for this request, set when the request completes. Null until a run starts, and on requests that never started one.';
