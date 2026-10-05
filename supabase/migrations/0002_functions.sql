-- Fresh-install baseline: access helpers, trigger functions and workflow RPCs.
-- Execute privileges are set in 0005_grants.sql.

-- Stamps updated_at on every row update.
create function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Reports whether the signed-in user holds the given role.
create function has_role(check_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and check_role = any(roles)
  );
$$;

-- Returns the signed-in user's team.
create function current_team_id() returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from profiles where id = auth.uid();
$$;

-- Reports whether the signed-in user may see an application: security and CIO see all, developers see their team's.
create function can_access_application(app_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select
    has_role('security') or has_role('cio')
    or exists (
      select 1 from applications
      where id = app_id and developer_team_id = current_team_id()
    );
$$;

-- Reports whether the signed-in user may see an assessment, through its application.
create function can_access_assessment(a_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_access_application(application_id) from assessments where id = a_id;
$$;

-- Reports whether the signed-in user may see a ticket, through its application.
create function can_access_ticket(t_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_access_application(application_id) from tickets where id = t_id;
$$;

-- Reports whether the signed-in user may see a ticket's control progress, through its ticket.
create function can_access_ticket_control(tc_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_access_ticket(ticket_id) from ticket_controls where id = tc_id;
$$;

-- Reports whether the signed-in user may see a risk conversation, through its application.
create function can_access_risk_conversation(c_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_access_application(application_id) from risk_conversations where id = c_id;
$$;

-- Decides access to a ticket-attachments object from its top-level folder: a conversation id or a ticket id.
create function can_access_attachment_object(object_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  folder text := (storage.foldername(object_name))[1];
begin
  if folder like 'conversation-%' then
    return coalesce(can_access_risk_conversation(substring(folder from 14)::uuid), false);
  end if;
  return coalesce(can_access_ticket(folder::uuid), false);
exception when others then
  return false;
end;
$$;

-- Decides access to an evidence object from its top-level folder: a finding id or a ticket id.
create function can_access_evidence_object(object_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  folder text := (storage.foldername(object_name))[1];
begin
  if folder like 'finding-%' then
    return exists (
      select 1 from findings
      where id = substring(folder from 9)::uuid
        and can_access_application(application_id)
    );
  elsif folder like 'ticket-%' then
    return can_access_ticket(substring(folder from 8)::uuid);
  end if;
  return false;
end;
$$;

-- Creates the developer profile for a newly signed-up auth user.
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, roles)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    array['developer']::text[]
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Stops clients changing a profile's id, their own roles, or anyone's roles or activation without the admin role.
create function prevent_role_escalation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'authenticated' then
    if new.id is distinct from old.id then
      raise exception 'id cannot be changed';
    end if;
    if new.roles is distinct from old.roles then
      if old.id = auth.uid() then
        raise exception 'you cannot change your own roles — ask another administrator';
      end if;
      if not has_role('admin') then
        raise exception 'roles can only be changed by an administrator';
      end if;
    end if;
    if new.is_active is distinct from old.is_active and not has_role('admin') then
      raise exception 'is_active can only be changed by an administrator';
    end if;
  end if;
  return new;
end;
$$;

-- Rejects assessment status changes outside the allowed transition map.
create function enforce_assessment_status_transition() returns trigger
language plpgsql as $$
declare
  legal constant jsonb := jsonb_build_object(
    'queued',    jsonb_build_array('queued', 'waiting', 'running', 'failed'),
    'waiting',   jsonb_build_array('waiting', 'queued', 'running', 'failed'),
    'running',   jsonb_build_array('running', 'completed', 'failed', 'queued'),
    'completed', jsonb_build_array('completed', 'queued'),
    'failed',    jsonb_build_array('failed', 'queued', 'waiting', 'running')
  );
begin
  if new.status = old.status then
    return new;
  end if;
  if not (legal -> old.status) ? new.status then
    raise exception 'an assessment cannot move from % to %', old.status, new.status;
  end if;
  return new;
end;
$$;

-- Enforces which ticket changes developers may make, and admits the reassessment functions' own status writes.
create function enforce_ticket_update_permissions() returns trigger
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

-- Keeps a risk conversation bound to its application, risk and originating assessment.
create function enforce_risk_conversation_identity() returns trigger
language plpgsql as $$
begin
  if new.risk_id is distinct from old.risk_id
    or (old.application_id is not null
        and new.application_id is distinct from old.application_id) then
    raise exception 'a risk conversation cannot be moved to another application or risk';
  end if;
  -- Clearing is what the foreign key does when an assessment is deleted.
  if old.origin_assessment_id is not null
    and new.origin_assessment_id is not null
    and new.origin_assessment_id is distinct from old.origin_assessment_id then
    raise exception 'a risk conversation keeps the assessment it was opened under';
  end if;
  return new;
end;
$$;

-- Bumps a conversation's updated_at when an entry is added.
create function touch_risk_conversation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update risk_conversations set updated_at = now() where id = new.conversation_id;
  return new;
end;
$$;

-- Validates a new reassessment request and records the ticket state to restore on withdrawal.
create function enforce_retest_request_permissions() returns trigger
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

-- Derives a remediation ticket's status from its outstanding reassessment requests.
create function reconcile_reassessment_ticket_state(p_ticket_id uuid) returns text
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

-- Creates a reassessment request and its conversation event, returning the existing pair when a submission is retried.
create function request_reassessment_entry(p_conversation_id uuid, p_finding_id uuid, p_ticket_id uuid, p_message text, p_submission_id uuid) returns jsonb
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

-- Starts the oldest queued reassessment for a risk, one running at a time; security only.
create function start_reassessment(p_retest_id uuid) returns retest_runs
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

-- Cancels the caller's queued reassessment and restores or reconciles the linked remediation.
create function withdraw_reassessment(p_retest_id uuid, p_reason text) returns retest_runs
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

  if r.ticket_id is not null then
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
  end if;

  -- A request that predates recorded restore states resumes as in-progress work.
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

  if r.ticket_id is not null then
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

-- Accepts a risk for the developer's team, cancels its reassessments and withdraws its remediation, recording each in the conversation.
create function accept_risk_entry(p_conversation_id uuid, p_finding_id uuid, p_reason text, p_submission_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cancellation constant text := 'Cancelled because the risk was accepted.';
  c risk_conversations;
  f findings;
  a risk_acceptance;
  t tickets;
  run retest_runs;
  cancelled_ids uuid[] := array[]::uuid[];
  withdrawal constant text := 'Risk accepted';
  remediation_id uuid;
  restore_to text;
  withdrawn_count integer := 0;
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

    -- Remediation stops while the risk is accepted; its steps and progress stay as history.
    for remediation_id in
      update tickets
      set status = 'withdrawn',
          withdrawn_at = now(),
          withdrawn_by = auth.uid(),
          withdrawal_reason = withdrawal,
          updated_at = now()
      where finding_id = f.id
        and type = 'remediation'
        and status in ('open', 'in_progress', 'rejected')
      returning id
    loop
      withdrawn_count := withdrawn_count + 1;
      insert into risk_conversation_entries
        (conversation_id, kind, author_id, message, source_ticket_id, sync_key)
      values (c.id, 'remediation_withdrawn', auth.uid(), withdrawal, remediation_id,
              'remediation-withdrawn::' || a.id::text || '::' || remediation_id::text)
      on conflict (sync_key) where sync_key is not null do nothing;
      insert into activity_log (actor_id, entity_type, entity_id, action, metadata)
      values (auth.uid(), 'ticket', remediation_id, 'remediation_withdrawn',
              jsonb_build_object('reason', withdrawal));
    end loop;

    insert into activity_log (actor_id, entity_type, entity_id, action, metadata)
    values (
      auth.uid(), 'ticket', t.id, 'risk_accepted',
      jsonb_build_object('finding_id', f.id, 'cancelled_reassessments',
                         coalesce(array_length(cancelled_ids, 1), 0),
                         'withdrawn_remediations', withdrawn_count)
    );
  end if;

  select id into entry_id
  from risk_conversation_entries
  where sync_key = 'risk-accepted::' || a.id::text;

  return jsonb_build_object('acceptance', to_jsonb(a), 'entry_id', entry_id);
end;
$$;

-- Retracts a risk acceptance for the developer's team and records the reason in the conversation.
create function retract_risk_acceptance(p_acceptance_id uuid, p_reason text) returns jsonb
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
create function end_risk_acceptance_on_reduced_risk() returns trigger
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

-- Changes a finding's classification and returns the finding with the conversation entry it recorded.
create function classify_risk_entry(p_finding_id uuid, p_conversation_id uuid, p_status text, p_reason text) returns jsonb
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

-- Changes a finding's classification and returns the finding; kept for callers that do not need the entry.
create function classify_risk(p_finding_id uuid, p_conversation_id uuid, p_status text, p_reason text) returns findings
language plpgsql security definer set search_path = public as $$
declare
  payload jsonb;
begin
  payload := classify_risk_entry(p_finding_id, p_conversation_id, p_status, p_reason);
  return jsonb_populate_record(null::findings, payload -> 'finding');
end;
$$;

-- Queues an assessment run for the backend worker, reusing an outstanding request; security only.
create function request_assessment_run(p_assessment_id uuid) returns assessment_run_requests
language plpgsql security definer set search_path = public as $$
declare
  a assessments;
  app applications;
  existing assessment_run_requests;
begin
  if auth.uid() is null or not has_role('security') then
    raise exception 'only the security team can start an assessment run';
  end if;

  select * into a from assessments where id = p_assessment_id;
  if not found then
    raise exception 'this assessment no longer exists';
  end if;
  if not can_access_assessment(a.id) then
    raise exception 'this assessment is outside your access';
  end if;
  if a.status = 'completed' then
    raise exception 'this assessment has already completed';
  end if;

  select * into app from applications where id = a.application_id;
  if not found then
    raise exception 'this assessment has no application';
  end if;

  select * into existing from assessment_run_requests
  where assessment_id = a.id
    and status in ('queued', 'waiting', 'claimed', 'running')
  for update;

  if found then
    -- A claimed or running request is left exactly as it is, so a repeated
    -- retry cannot start a second run.
    if existing.status in ('queued', 'waiting') then
      update assessment_run_requests
      set status = 'queued',
          next_attempt_at = now(),
          blocker_code = null,
          last_error = null
      where id = existing.id
      returning * into existing;
    end if;
    return existing;
  end if;

  insert into assessment_run_requests
    (assessment_id, application_id, platform, status, requested_by)
  values (a.id, app.id, app.platform, 'queued', auth.uid())
  returning * into existing;

  if a.status = 'failed' then
    update assessments set status = 'queued', updated_at = now() where id = a.id;
  end if;

  return existing;
end;
$$;

-- Leases the next due assessment run request to a worker.
create function claim_assessment_run_request(p_worker_id text, p_lease_seconds integer default 900) returns assessment_run_requests
language plpgsql security definer set search_path = public as $$
declare
  claimed assessment_run_requests;
begin
  select * into claimed from assessment_run_requests
  where status in ('queued', 'waiting')
    and next_attempt_at <= now()
  order by next_attempt_at, created_at
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update assessment_run_requests
  set status = 'claimed',
      attempts = attempts + 1,
      claimed_at = now(),
      lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
      worker_id = p_worker_id
  where id = claimed.id
  returning * into claimed;

  return claimed;
end;
$$;

-- Requeues run requests whose worker lease has expired.
create function recover_expired_assessment_run_leases() returns integer
language plpgsql security definer set search_path = public as $$
declare
  recovered integer;
begin
  update assessment_run_requests
  set status = 'queued',
      claimed_at = null,
      lease_expires_at = null,
      worker_id = null,
      blocker_code = 'lease_expired',
      next_attempt_at = now()
  where status in ('claimed', 'running')
    and lease_expires_at is not null
    and lease_expires_at < now();
  get diagnostics recovered = row_count;
  return recovered;
end;
$$;

-- Lists when each application's risk conversations last showed activity, an entry or a synced test run, under RLS.
create function risk_conversation_activity() returns table (application_id uuid, last_entry_at timestamptz)
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

-- Aggregates dashboard counts over the rows the caller can see under RLS.
create function dashboard_metrics() returns jsonb
language sql stable set search_path = public as $$
  with
  finding_counts as (
    select
      count(*) filter (where status = 'at_risk') as at_risk,
      count(*) filter (where status = 'reduced_risk') as reduced_risk,
      count(*) filter (where status = 'inconclusive') as inconclusive,
      count(*) filter (where severity = 'critical') as critical,
      count(*) filter (where severity = 'high') as high
    from findings
  ),
  ticket_counts as (
    select
      count(*) filter (where status = 'open') as open,
      count(*) filter (where status = 'in_progress') as in_progress,
      count(*) filter (where status = 'retest_requested') as retest_requested,
      count(*) filter (where status = 'retest_in_progress') as retest_in_progress,
      count(*) filter (where status = 'under_review') as under_review,
      count(*) filter (where status = 'accepted') as accepted,
      count(*) filter (where status = 'rejected') as rejected,
      count(*) filter (where status = 'closed') as closed,
      count(*) filter (
        where type = 'remediation' and status not in ('closed', 'accepted', 'rejected')
      ) as open_remediation,
      count(*) filter (where type = 'risk_acceptance' and status = 'under_review') as risk_acceptance_pending,
      count(*) filter (where type = 'risk_acceptance' and status = 'accepted') as accepted_risks,
      count(*) filter (where status in ('retest_requested', 'retest_in_progress')) as retest_pending
    from tickets
  ),
  app_counts as (
    select count(*) as applications_count from applications
  ),
  assessment_counts as (
    select
      count(*) as assessments_count,
      count(*) filter (where status = 'running') as assessments_running
    from assessments
  )
  select jsonb_build_object(
    'findingCounts', jsonb_build_object(
      'at_risk', finding_counts.at_risk,
      'reduced_risk', finding_counts.reduced_risk,
      'inconclusive', finding_counts.inconclusive
    ),
    'criticalFindings', finding_counts.critical,
    'highFindings', finding_counts.high,
    'ticketCounts', jsonb_build_object(
      'open', ticket_counts.open,
      'in_progress', ticket_counts.in_progress,
      'retest_requested', ticket_counts.retest_requested,
      'retest_in_progress', ticket_counts.retest_in_progress,
      'under_review', ticket_counts.under_review,
      'accepted', ticket_counts.accepted,
      'rejected', ticket_counts.rejected,
      'closed', ticket_counts.closed
    ),
    'openRemediation', ticket_counts.open_remediation,
    'riskAcceptancePending', ticket_counts.risk_acceptance_pending,
    'acceptedRisks', ticket_counts.accepted_risks,
    'retestPending', ticket_counts.retest_pending,
    'applicationsCount', app_counts.applications_count,
    'assessmentsCount', assessment_counts.assessments_count,
    'assessmentsRunning', assessment_counts.assessments_running
  )
  from finding_counts, ticket_counts, app_counts, assessment_counts;
$$;
