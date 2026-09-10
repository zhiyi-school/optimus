-- Requesting a reassessment no longer depends on remediation progress.
--
-- Progress is still recorded and still shown, but completing steps is a
-- developer's own tracking rather than a precondition: 0026 required a progress
-- row for the selected approach, at least one step, and every step completed.
-- Those three checks are dropped here. Everything else 0026 enforced is kept
-- verbatim — role and application access, the remediation ticket's type and
-- allowed states, ticket/conversation consistency, the required approach
-- selection, the security-role exception, and previous-status bookkeeping.
--
-- `create or replace` keeps the function's identity, so existing privileges and
-- the trigger binding carry over untouched.

create or replace function enforce_retest_request_permissions() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  requestable_from constant text[] :=
    array['open', 'in_progress', 'rejected', 'fix_submitted'];
  t tickets;
begin
  if new.ticket_id is not null then
    select * into t from tickets where id = new.ticket_id;
    if found and t.type = 'remediation' and t.status = any(requestable_from) then
      new.previous_ticket_status := t.status;
    end if;
  end if;

  if new.conversation_id is not null
    and new.ticket_id is not null
    and exists (
      select 1 from tickets
      where id = new.ticket_id
        and risk_conversation_id is not null
        and risk_conversation_id is distinct from new.conversation_id
    ) then
    raise exception 'a reassessment must be requested from a ticket opened against this risk';
  end if;

  if auth.role() is distinct from 'authenticated' then
    return new;
  end if;
  if has_role('security') then
    return new;
  end if;
  if new.ticket_id is null then
    raise exception 'a reassessment can only be requested from a remediation ticket';
  end if;

  select * into t from tickets where id = new.ticket_id;
  if not found or t.type <> 'remediation' then
    raise exception 'a reassessment can only be requested from a remediation ticket';
  end if;
  if not (t.status = any(requestable_from)) then
    raise exception 'this remediation is not in a state a reassessment can be requested from';
  end if;
  if coalesce(btrim(t.selected_control_id), '') = '' then
    raise exception 'choose a remediation approach before asking for a reassessment';
  end if;

  return new;
end;
$$;

comment on function enforce_retest_request_permissions() is
  'Gates a reassessment request on role, application access, a remediation ticket in an allowed state whose conversation matches, and a selected approach. Remediation progress is deliberately not a condition: completion records a developer''s own tracking, and security still runs the reassessment and decides the classification.';
