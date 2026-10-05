-- Makes risk_conversation_activity() count synced test runs as well as
-- conversation entries, so Last Updated moves when a test runs, not only when
-- someone posts. The result column keeps the name last_entry_at that 0039 gave
-- it, so this is a plain replacement and its grants are kept. Safe to run on a
-- fresh install, whose baseline already has this definition. See
-- docs/database-maintenance.md#test-runs-in-conversation-activity-0040.

-- Lists when each application's risk conversations last showed activity, an entry or a synced test run, under RLS.
create or replace function risk_conversation_activity() returns table (application_id uuid, last_entry_at timestamptz)
language sql stable set search_path = public as $$
  select activity.application_id, max(activity.at)
  from (
    select c.application_id, e.created_at as at
    from risk_conversation_entries e
    join risk_conversations c on c.id = e.conversation_id
    union all
    -- Test runs are not stored as entries; the sync worker stamps each run's result on its finding.
    select f.application_id, f.updated_at
    from findings f
    where f.latest_test_run_id is not null
  ) activity
  group by activity.application_id;
$$;
