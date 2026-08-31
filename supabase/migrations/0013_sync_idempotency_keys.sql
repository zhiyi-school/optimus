-- Idempotency keys for append-only rows written by the dashboard sync worker.
--
-- finding_history and activity_log are append-only, so a retried or concurrent
-- sync would otherwise add duplicate rows for the same run. The worker sets
-- sync_key to a value derived from the finding and the run timestamp; a second
-- write of the same row conflicts and is discarded.
--
-- The column is nullable and the indexes are partial so rows created by people
-- in the dashboard are unaffected and stay unconstrained.

alter table finding_history add column sync_key text;
alter table activity_log add column sync_key text;

create unique index finding_history_sync_key_idx
  on finding_history (sync_key)
  where sync_key is not null;

create unique index activity_log_sync_key_idx
  on activity_log (sync_key)
  where sync_key is not null;
