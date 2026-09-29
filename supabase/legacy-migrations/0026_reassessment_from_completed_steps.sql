-- Reassessment is requested from completed remediation steps, not from a fix submission.
--
-- `fix_submitted` was a state the developer set by hand before asking security
-- to retest. The step checklist already says whether the work is done, so the
-- separate submission is gone and a reassessment is requested straight from an
-- in-progress remediation. Completion is proved here, not only in the page.
--
-- `fix_submitted` stays a legal status: rows recorded before this keep it, and
-- may still be reassessed. Nothing creates a new one.

begin;

-- ---------------------------------------------------------------------------
-- 1. A request can now interrupt an in-progress remediation
-- ---------------------------------------------------------------------------

alter table retest_runs drop constraint retest_runs_previous_ticket_status_check;

alter table retest_runs add constraint retest_runs_previous_ticket_status_check
  check (previous_ticket_status is null
         or previous_ticket_status in ('open', 'in_progress', 'fix_submitted', 'rejected'));

-- ---------------------------------------------------------------------------
-- 2. Requesting proves the selected approach is finished
-- ---------------------------------------------------------------------------

create or replace function enforce_retest_request_permissions() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  requestable_from constant text[] :=
    array['open', 'in_progress', 'rejected', 'fix_submitted'];
  t tickets;
  control_row_id uuid;
  step_total integer;
  step_done integer;
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

  select id into control_row_id
  from ticket_controls
  where ticket_id = t.id and control_id = t.selected_control_id;
  if control_row_id is null then
    raise exception 'the selected remediation approach has no recorded progress yet';
  end if;

  select count(*), count(*) filter (where status = 'completed')
  into step_total, step_done
  from ticket_control_steps
  where ticket_control_id = control_row_id;

  if step_total = 0 then
    raise exception 'the selected remediation approach has no steps to complete';
  end if;
  if step_done < step_total then
    raise exception 'complete every step of the selected remediation approach first';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Withdrawal puts the remediation back where the request found it
-- ---------------------------------------------------------------------------

create or replace function enforce_ticket_update_permissions() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  developer_statuses constant text[] :=
    array['open', 'in_progress', 'fix_submitted', 'retest_requested', 'withdrawn'];
  withdrawable_from constant text[] :=
    array['open', 'in_progress', 'fix_submitted', 'rejected'];
  security_finalised constant text[] := array['closed', 'accepted'];
  selectable_from constant text[] := array['open', 'in_progress', 'fix_submitted', 'rejected'];
  restorable_to constant text[] := array['open', 'in_progress', 'fix_submitted', 'rejected'];
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
      raise exception 'the remediation approach cannot be changed once security verification has started';
    end if;
  end if;

  if withdrawing then
    if new.type is distinct from 'remediation' then
      raise exception 'only a remediation ticket can be withdrawn';
    end if;
    if not (old.status = any(withdrawable_from)) then
      raise exception 'a remediation ticket cannot be withdrawn once security verification has started';
    end if;
    if coalesce(btrim(new.withdrawal_reason), '') = '' then
      raise exception 'withdrawing a remediation ticket needs a reason';
    end if;
    if new.withdrawn_by is distinct from auth.uid() then
      raise exception 'the developer withdrawing the ticket must be recorded as withdrawn_by';
    end if;
    if new.withdrawn_at is null then
      raise exception 'withdrawing a remediation ticket must record withdrawn_at';
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

-- A request predating this recorded nothing; `in_progress` is where the
-- remediation now returns to, rather than a fix submission that never happened.
create or replace function withdraw_reassessment(p_retest_id uuid, p_reason text)
returns retest_runs
language plpgsql security definer set search_path = public as $$
declare
  r retest_runs;
  t tickets;
  reason constant text := btrim(coalesce(p_reason, ''));
  restore_to text;
begin
  if auth.uid() is null then
    raise exception 'only a signed-in developer can withdraw a reassessment';
  end if;
  if reason = '' then
    raise exception 'withdrawing a reassessment needs a reason';
  end if;

  select * into r from retest_runs where id = p_retest_id for update;
  if not found then
    raise exception 'this reassessment no longer exists';
  end if;
  if r.status <> 'queued' then
    raise exception 'only a queued reassessment can be withdrawn';
  end if;
  if r.requested_by is distinct from auth.uid() then
    raise exception 'only the developer who requested this reassessment can withdraw it';
  end if;
  if r.ticket_id is null then
    raise exception 'this reassessment is not linked to a remediation';
  end if;

  select * into t from tickets where id = r.ticket_id for update;
  if not found or t.type <> 'remediation' then
    raise exception 'this reassessment is not linked to a remediation';
  end if;
  if not can_access_ticket(t.id) then
    raise exception 'this remediation is outside your access';
  end if;
  if r.conversation_id is not null and not can_access_risk_conversation(r.conversation_id) then
    raise exception 'this conversation is outside your access';
  end if;
  if t.status <> 'retest_requested' then
    raise exception 'this remediation is no longer waiting for a reassessment';
  end if;

  restore_to := coalesce(r.previous_ticket_status, 'in_progress');

  update retest_runs
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = auth.uid(),
      cancellation_reason = reason
  where id = r.id and status = 'queued'
  returning * into r;

  if not found then
    raise exception 'this reassessment was already started or withdrawn';
  end if;

  perform set_config('app.withdrawing_reassessment', t.id::text, true);
  update tickets
  set status = restore_to, updated_at = now()
  where id = t.id;
  perform set_config('app.withdrawing_reassessment', '', true);

  if r.conversation_id is not null then
    insert into risk_conversation_entries
      (conversation_id, kind, author_id, message, source_ticket_id, sync_key)
    values (r.conversation_id, 'retest_withdrawn', auth.uid(), reason, t.id,
            'retest-withdrawn::' || r.id::text)
    on conflict (sync_key) where sync_key is not null do nothing;
  end if;

  return r;
end;
$$;

revoke all on function withdraw_reassessment(uuid, text) from public;
grant execute on function withdraw_reassessment(uuid, text) to authenticated;

commit;
