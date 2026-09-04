-- Withdrawing a queued reassessment request.
--
-- A developer who asked security to retest a fix may take that request back
-- while it is still queued. Cancelling the request must also put the
-- remediation ticket back where it was, so the two happen in one function
-- rather than as separate client writes.

begin;

-- ---------------------------------------------------------------------------
-- 1. Cancellation columns
-- ---------------------------------------------------------------------------

alter table retest_runs
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references profiles (id) on delete set null,
  add column cancellation_reason text,
  add column previous_ticket_status text;

alter table retest_runs drop constraint retest_runs_status_check;

alter table retest_runs add constraint retest_runs_status_check
  check (status in ('queued', 'running', 'completed', 'failed', 'cancelled'));

alter table retest_runs add constraint retest_runs_previous_ticket_status_check
  check (previous_ticket_status is null
         or previous_ticket_status in ('fix_submitted', 'rejected'));

-- Cancellation metadata belongs to a cancelled request and nothing else.
alter table retest_runs add constraint retest_runs_cancellation_fields check (
  case when status = 'cancelled' then
    cancelled_at is not null
    and cancelled_by is not null
    and coalesce(btrim(cancellation_reason), '') <> ''
  else
    cancelled_at is null
    and cancelled_by is null
    and cancellation_reason is null
  end
);

-- ---------------------------------------------------------------------------
-- 2. The request records what it interrupted
-- ---------------------------------------------------------------------------

alter table risk_conversation_entries drop constraint risk_conversation_entries_kind_check;

alter table risk_conversation_entries add constraint risk_conversation_entries_kind_check
  check (
    kind in (
      'message', 'classification_changed', 'retest_requested', 'retest_started',
      'retest_completed', 'retest_failed', 'retest_withdrawn', 'remediation_started',
      'remediation_withdrawn', 'fix_submitted'
    )
  );

-- The trigger already proves the ticket is in a state a reassessment may be
-- requested from, so it is also the one place that can record that state
-- without a client being able to choose it.
create or replace function enforce_retest_request_permissions() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t tickets;
begin
  if new.ticket_id is not null then
    select * into t from tickets where id = new.ticket_id;
    if found and t.type = 'remediation' and t.status in ('fix_submitted', 'rejected') then
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
  if not exists (
    select 1 from tickets
    where id = new.ticket_id
      and type = 'remediation'
      and status in ('fix_submitted', 'rejected')
  ) then
    raise exception 'a reassessment can only be requested once a fix has been submitted';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Starting and withdrawing race for the same queued row
-- ---------------------------------------------------------------------------

-- Security claims the request before any external automation starts, so a run
-- can never begin against a request the developer has already taken back.
create or replace function start_reassessment(p_retest_id uuid)
returns retest_runs
language plpgsql security definer set search_path = public as $$
declare
  r retest_runs;
begin
  if auth.uid() is null or not has_role('security') then
    raise exception 'only the security team can start a reassessment';
  end if;

  select * into r from retest_runs where id = p_retest_id for update;
  if not found then
    raise exception 'this reassessment request no longer exists';
  end if;
  if r.status = 'running' and r.executed_by = auth.uid() then
    return r;
  end if;
  if r.status = 'cancelled' then
    raise exception 'this reassessment request was withdrawn by the developer';
  end if;
  if r.status <> 'queued' then
    raise exception 'this reassessment request is already %', r.status;
  end if;

  update retest_runs
  set status = 'running', executed_by = auth.uid()
  where id = r.id and status = 'queued'
  returning * into r;

  if not found then
    raise exception 'this reassessment request was taken by another action';
  end if;
  return r;
end;
$$;

revoke all on function start_reassessment(uuid) from public;
grant execute on function start_reassessment(uuid) to authenticated;

create or replace function withdraw_reassessment(p_retest_id uuid, p_reason text)
returns retest_runs
language plpgsql security definer set search_path = public as $$
declare
  r retest_runs;
  t tickets;
  restore_to text;
  reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null then
    raise exception 'you must be signed in to withdraw a reassessment';
  end if;
  if reason = '' then
    raise exception 'withdrawing a reassessment needs a reason';
  end if;
  if not has_role('developer') then
    raise exception 'only the developer who asked for the reassessment can withdraw it';
  end if;
  if not exists (select 1 from profiles where id = auth.uid() and is_active) then
    raise exception 'this account is not active';
  end if;

  select * into r from retest_runs where id = p_retest_id for update;
  if not found then
    raise exception 'this reassessment request no longer exists';
  end if;
  if r.status = 'cancelled' then
    -- Already withdrawn: the caller retried, so return the same row unchanged.
    return r;
  end if;
  if r.status <> 'queued' then
    raise exception 'this reassessment is already %, so it can no longer be withdrawn', r.status;
  end if;
  if r.requested_by is distinct from auth.uid() then
    raise exception 'only the developer who asked for the reassessment can withdraw it';
  end if;
  if r.ticket_id is null then
    raise exception 'this reassessment has no remediation to restore';
  end if;

  select * into t from tickets where id = r.ticket_id for update;
  if not found or t.type <> 'remediation' then
    raise exception 'this reassessment is not linked to a remediation';
  end if;
  if not can_access_ticket(t.id) then
    raise exception 'this remediation is outside your access';
  end if;
  if r.conversation_id is not null and not can_access_risk_conversation(r.conversation_id) then
    raise exception 'this risk conversation is outside your access';
  end if;
  if t.status <> 'retest_requested' then
    raise exception 'this remediation is no longer waiting for a reassessment';
  end if;

  -- Requests made before this migration recorded nothing to restore; a fix was
  -- submitted to reach `retest_requested`, so that is the safe fallback.
  restore_to := coalesce(r.previous_ticket_status, 'fix_submitted');

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

-- ---------------------------------------------------------------------------
-- 4. The ticket restore this function performs, and nothing else
-- ---------------------------------------------------------------------------

-- `rejected` is not a status a developer may set, so the restore is allowed
-- only for the exact ticket `withdraw_reassessment` is holding open.
create or replace function enforce_ticket_update_permissions() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  developer_statuses constant text[] :=
    array['open', 'in_progress', 'fix_submitted', 'retest_requested', 'withdrawn'];
  withdrawable_from constant text[] :=
    array['open', 'in_progress', 'fix_submitted', 'rejected'];
  security_finalised constant text[] := array['closed', 'accepted'];
  selectable_from constant text[] := array['open', 'in_progress', 'fix_submitted', 'rejected'];
  restorable_to constant text[] := array['fix_submitted', 'rejected'];
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

commit;
