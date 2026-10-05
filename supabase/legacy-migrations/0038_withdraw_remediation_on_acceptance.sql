-- Accepting a risk now also withdraws its open remediation, with the reason
-- "Risk accepted", so the risk no longer reads as remediation in progress. The
-- steps and progress stay as history, and the developer can resume the
-- remediation after retracting the acceptance. Safe to run on a fresh install,
-- whose baseline already has this definition. See
-- docs/database-maintenance.md#remediation-withdrawn-on-acceptance-0038.

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
