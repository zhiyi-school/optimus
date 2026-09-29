-- Several reassessment requests may be outstanding for one risk, executed by
-- security one at a time.
--
-- 0021 allowed a single queued-or-running request per conversation. That is
-- replaced here by two narrower rules: at most one *running* request per
-- conversation, and submission-scoped idempotency so a retried Send resolves to
-- the request it already created instead of adding another. Ticket state is
-- derived from the outstanding requests rather than set independently by each
-- writer.

alter table retest_runs add column if not exists submission_id uuid;

comment on column retest_runs.submission_id is
  'Identifies one intentional submission. A retry of that submission carries the same value and resolves to the same request; a new Send carries a new one. Null on rows created before this migration.';

drop index if exists retest_runs_one_active_per_conversation;

create unique index if not exists retest_runs_one_running_per_conversation
  on retest_runs (conversation_id)
  where conversation_id is not null and status = 'running';

-- Scoped to the actor as well as the conversation, so one developer's retry can
-- never resolve to another developer's request.
create unique index if not exists retest_runs_submission_identity
  on retest_runs (conversation_id, requested_by, submission_id)
  where conversation_id is not null and submission_id is not null;

-- ---------------------------------------------------------------------------
-- Ticket state follows the outstanding requests
-- ---------------------------------------------------------------------------

create or replace function reconcile_reassessment_ticket_state(p_ticket_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  t tickets;
  running_count integer;
  queued_count integer;
  target text;
begin
  if p_ticket_id is null then
    return null;
  end if;
  select * into t from tickets where id = p_ticket_id for update;
  if not found or t.type <> 'remediation' then
    return null;
  end if;
  -- Security has finished with this remediation; the queue does not reopen it.
  if t.status in ('closed', 'accepted', 'withdrawn') then
    return t.status;
  end if;

  select
    count(*) filter (where status = 'running'),
    count(*) filter (where status = 'queued')
  into running_count, queued_count
  from retest_runs
  where ticket_id = t.id;

  if running_count > 0 then
    target := 'retest_in_progress';
  elsif queued_count > 0 then
    target := 'retest_requested';
  else
    return t.status;
  end if;

  if t.status is distinct from target then
    perform set_config('app.reconciling_reassessment', t.id::text, true);
    update tickets set status = target, updated_at = now() where id = t.id;
    perform set_config('app.reconciling_reassessment', '', true);
  end if;
  return target;
end;
$$;

revoke all on function reconcile_reassessment_ticket_state(uuid) from public, anon;
grant execute on function reconcile_reassessment_ticket_state(uuid) to authenticated, service_role;

-- The reconciler owns these transitions, so the ticket trigger recognises them
-- the same way it already recognises a withdrawal's restoration.
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
    if new.closed_at is distinct from old.closed_at then
      raise exception 'withdrawing a remediation does not close the finding';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- One submission, one request
-- ---------------------------------------------------------------------------

create or replace function request_reassessment_entry(
  p_conversation_id uuid,
  p_finding_id uuid,
  p_ticket_id uuid,
  p_message text,
  p_submission_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r retest_runs;
  entry_id uuid;
  note text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if auth.uid() is null then
    raise exception 'you must be signed in to ask for a reassessment';
  end if;
  if p_conversation_id is null or p_submission_id is null then
    raise exception 'a reassessment request needs a conversation and a submission id';
  end if;
  if not can_access_risk_conversation(p_conversation_id) then
    raise exception 'this risk conversation is outside your access';
  end if;

  -- A retry of the same submission resolves to the request it already made,
  -- whatever happened to the first response.
  select * into r
  from retest_runs
  where conversation_id = p_conversation_id
    and requested_by = auth.uid()
    and submission_id = p_submission_id;

  if not found then
    insert into retest_runs
      (conversation_id, ticket_id, finding_id, requested_by, status, submission_id)
    values (p_conversation_id, p_ticket_id, p_finding_id, auth.uid(), 'queued', p_submission_id)
    returning * into r;
  end if;

  insert into risk_conversation_entries
    (conversation_id, kind, author_id, message, source_ticket_id, sync_key)
  values (p_conversation_id, 'retest_requested', auth.uid(), note, r.ticket_id,
          'retest-requested::' || r.id::text)
  on conflict (sync_key) where sync_key is not null do nothing;

  select id into entry_id
  from risk_conversation_entries
  where sync_key = 'retest-requested::' || r.id::text;

  perform reconcile_reassessment_ticket_state(r.ticket_id);

  return jsonb_build_object('run', to_jsonb(r), 'entry_id', entry_id);
end;
$$;

revoke all on function request_reassessment_entry(uuid, uuid, uuid, text, uuid) from public, anon;
grant execute on function request_reassessment_entry(uuid, uuid, uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Security starts one request at a time, oldest first
-- ---------------------------------------------------------------------------

create or replace function start_reassessment(p_retest_id uuid)
returns retest_runs
language plpgsql security definer set search_path = public as $$
declare
  r retest_runs;
  oldest uuid;
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

  -- One execution per risk at a time. The lock above orders two concurrent
  -- starts of the same request; this rejects a start of a second one.
  if r.conversation_id is not null and exists (
    select 1 from retest_runs
    where conversation_id = r.conversation_id and status = 'running'
  ) then
    raise exception 'another reassessment for this risk is already running';
  end if;

  if r.conversation_id is not null then
    select id into oldest
    from retest_runs
    where conversation_id = r.conversation_id and status = 'queued'
    order by created_at, id
    limit 1;
    if oldest is distinct from r.id then
      raise exception 'an earlier reassessment request for this risk is still waiting';
    end if;
  end if;

  update retest_runs
  set status = 'running', executed_by = auth.uid()
  where id = r.id and status = 'queued'
  returning * into r;

  if not found then
    raise exception 'this reassessment request was taken by another action';
  end if;

  perform reconcile_reassessment_ticket_state(r.ticket_id);
  return r;
end;
$$;

revoke all on function start_reassessment(uuid) from public, anon;
grant execute on function start_reassessment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Withdrawal restores the ticket only when nothing else is outstanding
-- ---------------------------------------------------------------------------

create or replace function withdraw_reassessment(p_retest_id uuid, p_reason text)
returns retest_runs
language plpgsql security definer set search_path = public as $$
declare
  r retest_runs;
  t tickets;
  restore_to text;
  outstanding integer;
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
  if t.status not in ('retest_requested', 'retest_in_progress') then
    raise exception 'this remediation is no longer waiting for a reassessment';
  end if;

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

  -- Restoring the remediation is only correct once nothing else is waiting;
  -- otherwise the queue decides the ticket's state.
  select count(*) into outstanding
  from retest_runs
  where ticket_id = t.id and status in ('queued', 'running');

  if outstanding = 0 then
    perform set_config('app.withdrawing_reassessment', t.id::text, true);
    update tickets set status = restore_to, updated_at = now() where id = t.id;
    perform set_config('app.withdrawing_reassessment', '', true);
  else
    perform reconcile_reassessment_ticket_state(t.id);
  end if;

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

revoke all on function withdraw_reassessment(uuid, text) from public, anon;
grant execute on function withdraw_reassessment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- A second request is allowed while earlier ones are outstanding
-- ---------------------------------------------------------------------------

create or replace function enforce_retest_request_permissions() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  -- The states a remediation may be worked on from, plus the states it reaches
  -- once a reassessment is already outstanding or has just been run.
  requestable_from constant text[] :=
    array['open', 'in_progress', 'rejected', 'fix_submitted',
          'retest_requested', 'retest_in_progress', 'under_review'];
  -- Only a pre-queue state is worth restoring if every request is withdrawn.
  restorable_from constant text[] :=
    array['open', 'in_progress', 'rejected', 'fix_submitted'];
  t tickets;
begin
  if new.ticket_id is not null then
    select * into t from tickets where id = new.ticket_id;
    if found and t.type = 'remediation' and t.status = any(restorable_from) then
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
  'Gates a reassessment request on role, application access, a remediation ticket in an allowed state whose conversation matches, and a selected approach. Several requests may be outstanding at once; remediation progress is deliberately not a condition. previous_ticket_status records only a pre-queue state, so withdrawing the last outstanding request restores something meaningful.';
