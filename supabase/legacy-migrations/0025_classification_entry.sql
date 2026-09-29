-- Classification, and the conversation entry it created.
--
-- `classify_risk` returns only the finding, so a caller that wants to attach a
-- file to the decision has to guess which entry it just wrote. Looking the entry
-- up afterwards races a concurrent classification of the same risk, so the id is
-- returned by the function that created it instead.
--
-- `classify_risk` is left exactly as it was: existing callers keep working, and
-- both functions share one body so the transaction cannot drift apart.

begin;

create or replace function classify_risk_entry(
  p_finding_id uuid,
  p_conversation_id uuid,
  p_status text,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  f findings;
  c risk_conversations;
  trimmed text := btrim(coalesce(p_reason, ''));
  entry_id uuid;
begin
  if auth.uid() is null or not has_role('security') then
    raise exception 'only the security team can change a risk classification';
  end if;
  if trimmed = '' then
    raise exception 'changing the risk classification needs a reason';
  end if;
  if p_status not in ('at_risk', 'reduced_risk', 'inconclusive') then
    raise exception 'unknown risk classification %', p_status;
  end if;

  select * into c from risk_conversations where id = p_conversation_id;
  if not found then
    raise exception 'this conversation no longer exists';
  end if;

  select * into f from findings where id = p_finding_id for update;
  if not found then
    raise exception 'this finding no longer exists';
  end if;
  if f.application_id is distinct from c.application_id
    or f.test_id is distinct from c.risk_id then
    raise exception 'that finding belongs to a different application risk';
  end if;

  update findings set status = p_status, updated_at = now() where id = f.id;

  insert into finding_history (finding_id, previous_status, new_status, changed_by, reason)
  values (f.id, f.status, p_status, auth.uid(), trimmed);

  insert into risk_conversation_entries
    (conversation_id, kind, author_id, message, metadata)
  values (
    c.id, 'classification_changed', auth.uid(), trimmed,
    jsonb_build_object('previous_status', f.status, 'new_status', p_status)
  )
  returning id into entry_id;

  insert into activity_log (actor_id, entity_type, entity_id, action, metadata)
  values (
    auth.uid(), 'finding', f.id, 'finding_status_changed',
    jsonb_build_object('previous_status', f.status, 'new_status', p_status)
  );

  select * into f from findings where id = f.id;
  return jsonb_build_object('finding', to_jsonb(f), 'entry_id', entry_id);
end;
$$;

revoke all on function classify_risk_entry(uuid, uuid, text, text) from public;
grant execute on function classify_risk_entry(uuid, uuid, text, text) to authenticated;

-- The original now delegates, so the two can never record the decision differently.
create or replace function classify_risk(
  p_finding_id uuid,
  p_conversation_id uuid,
  p_status text,
  p_reason text
) returns findings
language plpgsql security definer set search_path = public as $$
declare
  payload jsonb;
begin
  payload := classify_risk_entry(p_finding_id, p_conversation_id, p_status, p_reason);
  return jsonb_populate_record(null::findings, payload -> 'finding');
end;
$$;

revoke all on function classify_risk(uuid, uuid, text, text) from public;
grant execute on function classify_risk(uuid, uuid, text, text) to authenticated;

commit;
