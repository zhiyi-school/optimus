-- Adds risk_conversation_activity(), which the Assess and Resolve lists read
-- for their Last Updated column: the newest conversation entry per application.
-- It runs as the caller, so RLS limits it to conversations they can see. Safe to
-- run on a fresh install, whose baseline already has it. See
-- docs/database-maintenance.md#conversation-activity-0039.

begin;

-- Lists when each application's risk conversations last recorded an entry, over the rows the caller can see under RLS.
create or replace function risk_conversation_activity() returns table (application_id uuid, last_entry_at timestamptz)
language sql stable set search_path = public as $$
  select c.application_id, max(e.created_at)
  from risk_conversation_entries e
  join risk_conversations c on c.id = e.conversation_id
  group by c.application_id;
$$;

revoke all on function risk_conversation_activity() from public, anon;
grant execute on function risk_conversation_activity() to authenticated, service_role;

commit;
