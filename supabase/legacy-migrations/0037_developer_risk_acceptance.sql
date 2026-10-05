-- Lets a developer accept a risk from its conversation, and retract that
-- acceptance. Accepting cancels the risk's outstanding reassessments and blocks
-- new ones; a later Reduced Risk result ends the acceptance. Safe to run on a
-- fresh install, whose baseline already has every change. See
-- docs/database-maintenance.md#developer-risk-acceptance-0037.

begin;

-- ---------------------------------------------------------------------------
-- Acceptance lifecycle columns and conversation events
-- ---------------------------------------------------------------------------

alter table risk_acceptance
  add column if not exists conversation_id uuid references risk_conversations (id) on delete set null,
  add column if not exists accepted_run_id text,
  add column if not exists accepted_status text
    check (accepted_status in ('at_risk', 'reduced_risk', 'inconclusive')),
  add column if not exists submission_id uuid,
  add column if not exists ended_at timestamptz,
  add column if not exists ended_by uuid references profiles (id) on delete set null,
  add column if not exists end_reason text check (end_reason in ('retracted', 'resolved')),
  add column if not exists end_note text;

alter table risk_acceptance drop constraint if exists risk_acceptance_end_fields;
alter table risk_acceptance add constraint risk_acceptance_end_fields check (
  (ended_at is null) = (end_reason is null)
  and (end_reason is distinct from 'retracted' or coalesce(btrim(end_note), '') <> '')
);

create unique index if not exists risk_acceptance_one_active_per_finding
  on risk_acceptance (finding_id) where decision = 'accepted' and ended_at is null;
create unique index if not exists risk_acceptance_submission_identity
  on risk_acceptance (conversation_id, requested_by, submission_id)
  where conversation_id is not null and submission_id is not null;

comment on column risk_acceptance.end_reason is
  'Why an accepted risk stopped being accepted: retracted by a developer, or resolved when its result became Reduced Risk. Null while the acceptance is in force.';

alter table risk_conversation_entries drop constraint risk_conversation_entries_kind_check;
alter table risk_conversation_entries add constraint risk_conversation_entries_kind_check
  check (kind in (
    'message', 'classification_changed', 'retest_requested', 'retest_started',
    'retest_completed', 'retest_failed', 'retest_withdrawn', 'remediation_started',
    'remediation_withdrawn', 'fix_submitted', 'risk_accepted', 'risk_acceptance_retracted',
    'risk_acceptance_ended'
  ));

-- ---------------------------------------------------------------------------
-- Guards: the ticket transitions acceptance makes, and no reassessment while accepted
-- ---------------------------------------------------------------------------

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

  if coalesce(current_setting('app.accepting_risk', true), '') = old.id::text
    and old.status = any(reconciled_to)
    and new.status = any(restorable_to)
    and new.type is not distinct from old.type
    and new.finding_id is not distinct from old.finding_id
    and new.application_id is not distinct from old.application_id
    and new.withdrawn_at is not distinct from old.withdrawn_at
    and new.closed_at is not distinct from old.closed_at then
    return new;
  end if;

  if coalesce(current_setting('app.ending_risk_acceptance', true), '') = old.id::text
    and old.type = 'risk_acceptance'
    and old.status = 'accepted'
    and new.status in ('withdrawn', 'closed')
    and new.type is not distinct from old.type
    and new.finding_id is not distinct from old.finding_id
    and new.application_id is not distinct from old.application_id
    and new.withdrawn_at is not distinct from old.withdrawn_at then
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

create or replace function enforce_retest_request_permissions() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  -- Only a pre-queue state is worth restoring if every request is withdrawn.
  restorable_from constant text[] := array['open', 'in_progress', 'rejected'];
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
  -- Shares the lock accept_risk_entry takes, so a request and an acceptance never interleave.
  perform 1 from findings where id = new.finding_id for share;
  if exists (
    select 1 from risk_acceptance
    where finding_id = new.finding_id and decision = 'accepted' and ended_at is null
  ) then
    raise exception 'this risk has been accepted, so it cannot be reassessed until the acceptance is retracted';
  end if;
  if has_role('security') then
    return new;
  end if;
  if new.ticket_id is null then
    if new.conversation_id is null then
      raise exception 'a reassessment needs a risk conversation';
    end if;
    return new;
  end if;

  select * into t from tickets where id = new.ticket_id;
  if not found or t.type <> 'remediation' then
    raise exception 'a reassessment can only be linked to a remediation ticket';
  end if;
  return new;
end;
$$;

comment on function enforce_retest_request_permissions() is
  'Gates a reassessment request on role and application access. A developer may ask from the risk conversation alone; a request that does name a ticket must name a remediation ticket opened against this risk. Neither remediation state, a selected approach, nor progress is a condition, and several requests may be outstanding at once, but none while the risk is accepted. previous_ticket_status records only a pre-queue state, so withdrawing the last outstanding request restores something meaningful.';

-- ---------------------------------------------------------------------------
-- Accepting, retracting and ending an acceptance
-- ---------------------------------------------------------------------------

-- Accepts a risk for the developer's team, cancels its outstanding reassessments, and records both in the conversation.
create or replace function accept_risk_entry(p_conversation_id uuid, p_finding_id uuid, p_reason text, p_submission_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cancellation constant text := 'Cancelled because the risk was accepted.';
  c risk_conversations;
  f findings;
  a risk_acceptance;
  t tickets;
  run retest_runs;
  cancelled_ids uuid[] := array[]::uuid[];
  remediation_id uuid;
  restore_to text;
  entry_id uuid;
  note text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null then
    raise exception 'you must be signed in to accept a risk';
  end if;
  if not has_role('developer') then
    raise exception 'only a developer on this application''s team can accept its risk';
  end if;
  if not exists (select 1 from profiles where id = auth.uid() and is_active) then
    raise exception 'this account is not active';
  end if;
  if note = '' then
    raise exception 'accepting a risk needs a reason';
  end if;
  if p_conversation_id is null or p_submission_id is null then
    raise exception 'accepting a risk needs a conversation and a submission id';
  end if;

  select * into c from risk_conversations where id = p_conversation_id;
  if not found then
    raise exception 'this conversation no longer exists';
  end if;
  if not can_access_risk_conversation(c.id) then
    raise exception 'this risk conversation is outside your access';
  end if;

  -- The finding lock orders this against another acceptance or a reassessment request.
  select * into f from findings where id = p_finding_id for update;
  if not found then
    raise exception 'this finding no longer exists';
  end if;
  if f.application_id is distinct from c.application_id
    or f.test_id is distinct from c.risk_id then
    raise exception 'that finding belongs to a different application risk';
  end if;

  -- A retry of the same submission resolves to the acceptance it already made.
  select * into a
  from risk_acceptance
  where conversation_id = c.id
    and requested_by = auth.uid()
    and submission_id = p_submission_id;

  if not found then
    if f.status = 'reduced_risk' then
      raise exception 'this risk is already Reduced Risk, so there is nothing to accept';
    end if;
    if exists (
      select 1 from risk_acceptance
      where finding_id = f.id and decision = 'accepted' and ended_at is null
    ) then
      raise exception 'this risk has already been accepted';
    end if;

    insert into tickets
      (finding_id, application_id, type, status, title, created_by, risk_conversation_id)
    values (f.id, f.application_id, 'risk_acceptance', 'accepted', 'Risk accepted: ' || f.title,
            auth.uid(), c.id)
    returning * into t;

    insert into risk_acceptance
      (ticket_id, finding_id, requested_by, reason, decision, conversation_id,
       accepted_run_id, accepted_status, submission_id)
    values (t.id, f.id, auth.uid(), note, 'accepted', c.id,
            f.latest_test_run_id, f.status, p_submission_id)
    returning * into a;

    insert into risk_conversation_entries
      (conversation_id, kind, author_id, message, metadata, source_ticket_id, sync_key)
    values (
      c.id, 'risk_accepted', auth.uid(), note,
      jsonb_build_object('acceptance_id', a.id, 'finding_status', f.status,
                         'run_id', f.latest_test_run_id),
      t.id, 'risk-accepted::' || a.id::text
    );

    for run in
      update retest_runs
      set status = 'cancelled',
          cancelled_at = now(),
          cancelled_by = auth.uid(),
          cancellation_reason = cancellation
      where (conversation_id = c.id or finding_id = f.id)
        and status in ('queued', 'running')
      returning *
    loop
      cancelled_ids := cancelled_ids || run.id;
      if run.conversation_id is not null then
        insert into risk_conversation_entries
          (conversation_id, kind, author_id, message, source_ticket_id, sync_key)
        values (run.conversation_id, 'retest_withdrawn', auth.uid(), cancellation, run.ticket_id,
                'retest-withdrawn::' || run.id::text)
        on conflict (sync_key) where sync_key is not null do nothing;
      end if;
    end loop;

    -- Every outstanding request was cancelled, so each linked remediation returns to
    -- the state its earliest request recorded.
    for remediation_id, restore_to in
      select r.ticket_id,
             coalesce(
               (array_agg(r.previous_ticket_status order by r.created_at, r.id)
                  filter (where r.previous_ticket_status is not null))[1],
               'in_progress')
      from retest_runs r
      where r.id = any(cancelled_ids) and r.ticket_id is not null
      group by r.ticket_id
    loop
      perform set_config('app.accepting_risk', remediation_id::text, true);
      update tickets set status = restore_to, updated_at = now()
      where id = remediation_id
        and type = 'remediation'
        and status in ('retest_requested', 'retest_in_progress');
      perform set_config('app.accepting_risk', '', true);
    end loop;

    insert into activity_log (actor_id, entity_type, entity_id, action, metadata)
    values (
      auth.uid(), 'ticket', t.id, 'risk_accepted',
      jsonb_build_object('finding_id', f.id, 'cancelled_reassessments',
                         coalesce(array_length(cancelled_ids, 1), 0))
    );
  end if;

  select id into entry_id
  from risk_conversation_entries
  where sync_key = 'risk-accepted::' || a.id::text;

  return jsonb_build_object('acceptance', to_jsonb(a), 'entry_id', entry_id);
end;
$$;

-- Retracts a risk acceptance for the developer's team and records the reason in the conversation.
create or replace function retract_risk_acceptance(p_acceptance_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a risk_acceptance;
  entry_id uuid;
  note text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null then
    raise exception 'you must be signed in to retract a risk acceptance';
  end if;
  if not has_role('developer') then
    raise exception 'only a developer on this application''s team can retract its risk acceptance';
  end if;
  if not exists (select 1 from profiles where id = auth.uid() and is_active) then
    raise exception 'this account is not active';
  end if;
  if note = '' then
    raise exception 'retracting a risk acceptance needs a reason';
  end if;

  select * into a from risk_acceptance where id = p_acceptance_id for update;
  if not found then
    raise exception 'this risk acceptance no longer exists';
  end if;
  if not can_access_ticket(a.ticket_id) then
    raise exception 'this risk acceptance is outside your access';
  end if;

  if a.end_reason = 'retracted' then
    -- A retry resolves to the retraction already recorded.
    select id into entry_id
    from risk_conversation_entries
    where sync_key = 'risk-acceptance-ended::' || a.id::text;
    return jsonb_build_object('acceptance', to_jsonb(a), 'entry_id', entry_id);
  end if;
  if a.ended_at is not null then
    raise exception 'this risk acceptance already ended when the risk became Reduced Risk';
  end if;
  if a.decision is distinct from 'accepted' then
    raise exception 'only an accepted risk can be retracted';
  end if;

  update risk_acceptance
  set ended_at = now(), ended_by = auth.uid(), end_reason = 'retracted', end_note = note
  where id = a.id
  returning * into a;

  perform set_config('app.ending_risk_acceptance', a.ticket_id::text, true);
  update tickets set status = 'withdrawn', updated_at = now()
  where id = a.ticket_id and status = 'accepted';
  perform set_config('app.ending_risk_acceptance', '', true);

  if a.conversation_id is not null then
    insert into risk_conversation_entries
      (conversation_id, kind, author_id, message, metadata, source_ticket_id, sync_key)
    values (a.conversation_id, 'risk_acceptance_retracted', auth.uid(), note,
            jsonb_build_object('acceptance_id', a.id), a.ticket_id,
            'risk-acceptance-ended::' || a.id::text)
    returning id into entry_id;
  end if;

  insert into activity_log (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'ticket', a.ticket_id, 'risk_acceptance_retracted',
          jsonb_build_object('finding_id', a.finding_id));

  return jsonb_build_object('acceptance', to_jsonb(a), 'entry_id', entry_id);
end;
$$;

-- Ends a risk's acceptance once its result becomes Reduced Risk and records that in the conversation.
create or replace function end_risk_acceptance_on_reduced_risk() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  a risk_acceptance;
begin
  for a in
    update risk_acceptance
    set ended_at = now(), ended_by = new.changed_by, end_reason = 'resolved'
    where finding_id = new.finding_id and decision = 'accepted' and ended_at is null
    returning *
  loop
    perform set_config('app.ending_risk_acceptance', a.ticket_id::text, true);
    update tickets set status = 'closed', closed_at = now(), updated_at = now()
    where id = a.ticket_id and status = 'accepted';
    perform set_config('app.ending_risk_acceptance', '', true);

    if a.conversation_id is not null then
      insert into risk_conversation_entries
        (conversation_id, kind, author_id, metadata, source_ticket_id, sync_key)
      values (
        a.conversation_id, 'risk_acceptance_ended', new.changed_by,
        jsonb_build_object('acceptance_id', a.id, 'previous_status', new.previous_status,
                           'new_status', new.new_status),
        a.ticket_id, 'risk-acceptance-ended::' || a.id::text
      )
      on conflict (sync_key) where sync_key is not null do nothing;
    end if;
  end loop;
  return null;
end;
$$;

comment on function end_risk_acceptance_on_reduced_risk() is
  'Runs at commit for each finding_history row whose new status is reduced_risk, from an automation result or a security reclassification. A result that stays At Risk or Inconclusive writes no such row, so the acceptance stays in force.';

drop trigger if exists trg_end_risk_acceptance_on_reduced_risk on finding_history;
-- Deferred to commit so the ending is recorded after the change that caused it.
create constraint trigger trg_end_risk_acceptance_on_reduced_risk
  after insert on finding_history
  deferrable initially deferred
  for each row when (new.new_status = 'reduced_risk')
  execute function end_risk_acceptance_on_reduced_risk();

-- ---------------------------------------------------------------------------
-- Clients may only open a pending request; accept_risk_entry records acceptances
-- ---------------------------------------------------------------------------

drop policy if exists risk_acceptance_insert on risk_acceptance;
create policy risk_acceptance_insert on risk_acceptance for insert to authenticated
  with check (
    requested_by = auth.uid()
    and (has_role('developer') or has_role('security'))
    and can_access_ticket(ticket_id)
    and coalesce(decision, 'pending') = 'pending'
    and ended_at is null
    and end_reason is null
  );

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function
  accept_risk_entry(uuid, uuid, text, uuid),
  retract_risk_acceptance(uuid, text)
from public, anon;

grant execute on function
  accept_risk_entry(uuid, uuid, text, uuid),
  retract_risk_acceptance(uuid, text)
to authenticated, service_role;

commit;
