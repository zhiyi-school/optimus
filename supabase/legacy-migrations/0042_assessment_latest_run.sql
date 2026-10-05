-- Records the newest automation run applied to each assessment, so a risk rerun
-- updates the assessment it belongs to instead of adding a new one, and a
-- replayed older report cannot overwrite newer progress. Safe to run on a fresh
-- install, whose baseline already has the column. See
-- docs/database-maintenance.md#latest-run-on-assessments-0042.

alter table assessments add column if not exists latest_run_id text;

comment on column assessments.latest_run_id is
  'The newest automation run applied to this assessment: its own run, then any rerun of one of its risks. The dashboard sync skips an older run, so a replayed report never overwrites newer progress. Null until a run is synced.';
