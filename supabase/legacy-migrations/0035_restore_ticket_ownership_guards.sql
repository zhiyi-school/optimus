-- Restores the developer-side ticket guards that 0030 dropped when it replaced
-- enforce_ticket_update_permissions(): withdrawal details are written once,
-- only security sets closed_at, and ownership fields stay fixed. See
-- docs/database-maintenance.md#restoring-ticket-guards-0035.

create or replace function enforce_ticket_update_permissions() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  developer_statuses constant text[] :=
    array['open', 'in_progress', 'retest_requested', 'withdrawn'];
  withdrawable_from constant text[] :=
    array['open', 'in_progress', 'rejected'];
  security_finalised constant text[] := array['closed', 'accepted'];
  selectable_from constant text[] := array['open', 'in_progress', 'rejected'];
  restorable_to constant text[] := array['open', 'in_progress', 'rejected'];
  reconciled_to constant text[] := array['retest_requested', 'retest_in_progress'];
  withdrawing constant boolean :=
    new.status = 'withdrawn' and old.status is distinct from 'withdrawn';
begin
  if auth.role() is distinct from 'authenticated' then
    return new;
  end if;

  if old.risk_conversation_id is not null
    and new.risk_conversation_id is distinct from old.risk_conversation_id then
    raise exception 'a ticket keeps the risk conversation it was opened against';
  end if;

  if old.origin_assessment_id is not null
    and new.origin_assessment_id is not null
    and new.origin_assessment_id is distinct from old.origin_assessment_id then
    raise exception 'a ticket keeps the assessment it was opened against';
  end if;

  if coalesce(current_setting('app.reconciling_reassessment', true), '') = old.id::text
    and new.status = any(reconciled_to)
    and new.type is not distinct from old.type
    and new.finding_id is not distinct from old.finding_id
    and new.application_id is not distinct from old.application_id
    and new.withdrawn_at is not distinct from old.withdrawn_at
    and new.closed_at is not distinct from old.closed_at then
    return new;
  end if;

  if coalesce(current_setting('app.withdrawing_reassessment', true), '') = old.id::text
    and old.status = 'retest_requested'
    and new.status = any(restorable_to)
    and new.type is not distinct from old.type
    and new.finding_id is not distinct from old.finding_id
    and new.application_id is not distinct from old.application_id
    and new.withdrawn_at is not distinct from old.withdrawn_at
    and new.closed_at is not distinct from old.closed_at then
    return new;
  end if;

  if has_role('security') or has_role('admin') then
    return new;
  end if;

  if old.status = any(security_finalised) then
    raise exception 'only the security team can reopen a ticket it has finalised';
  end if;

  if new.status is distinct from old.status and not (new.status = any(developer_statuses)) then
    raise exception 'only the security team can move a ticket to %', new.status;
  end if;

  if old.status = 'withdrawn'
    and new.status is distinct from old.status
    and new.status <> 'in_progress' then
    raise exception 'a withdrawn remediation ticket resumes as in_progress';
  end if;

  if new.selected_control_id is distinct from old.selected_control_id then
    if new.type is distinct from 'remediation' then
      raise exception 'only a remediation ticket has a remediation approach';
    end if;
    if not (old.status = any(selectable_from)) then
      raise exception 'the remediation approach can no longer be changed';
    end if;
  end if;

  if withdrawing then
    if new.type is distinct from 'remediation' then
      raise exception 'only a remediation ticket can be withdrawn';
    end if;
    if not (old.status = any(withdrawable_from)) then
      raise exception 'this remediation can no longer be withdrawn';
    end if;
    if coalesce(btrim(new.withdrawal_reason), '') = '' then
      raise exception 'withdrawing a remediation needs a reason';
    end if;
    if new.withdrawn_by is distinct from auth.uid() then
      raise exception 'a withdrawal records the developer who made it';
    end if;
    if new.withdrawn_at is null then
      raise exception 'a withdrawal records when it was made';
    end if;
    if new.closed_at is distinct from old.closed_at then
      raise exception 'withdrawing a remediation does not close the finding';
    end if;
  elsif new.withdrawn_at is distinct from old.withdrawn_at
    or new.withdrawn_by is distinct from old.withdrawn_by
    or new.withdrawal_reason is distinct from old.withdrawal_reason then
    raise exception 'withdrawal details are recorded once, when the ticket is withdrawn';
  end if;

  if new.closed_at is distinct from old.closed_at then
    raise exception 'only the security team can close or reopen a ticket';
  end if;

  if new.type is distinct from old.type
    or new.finding_id is distinct from old.finding_id
    or new.application_id is distinct from old.application_id
    or new.created_by is distinct from old.created_by
    or new.assigned_team_id is distinct from old.assigned_team_id
    or new.assigned_user_id is distinct from old.assigned_user_id then
    raise exception 'only the security team can change a ticket''s ownership fields';
  end if;

  return new;
end;
$$;
