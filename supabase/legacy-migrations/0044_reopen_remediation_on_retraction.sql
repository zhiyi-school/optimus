-- Retracting a risk acceptance now reopens the remediation that accepting it
-- withdrew, as `open`, so the risk reads Action required again rather than
-- Withdrawn by developer. Remediations retracted before this fix are reopened
-- the same way. Safe to run on a fresh install, whose baseline already has
-- these definitions. See
-- docs/database-maintenance.md#remediation-reopened-on-retraction-0044.

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

  if coalesce(current_setting('app.restoring_remediation', true), '') = old.id::text
    and old.type = 'remediation'
    and old.status = 'withdrawn'
    and new.status = 'open'
    and new.type is not distinct from old.type
    and new.finding_id is not distinct from old.finding_id
    and new.application_id is not distinct from old.application_id
    and new.withdrawn_at is not distinct from old.withdrawn_at
    and new.withdrawn_by is not distinct from old.withdrawn_by
    and new.withdrawal_reason is not distinct from old.withdrawal_reason
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

create or replace function restore_remediation_paused_by_acceptance(p_acceptance_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  a risk_acceptance;
  remediation_id uuid;
begin
  select * into a from risk_acceptance where id = p_acceptance_id;
  if not found or a.end_reason is distinct from 'retracted' then
    return 0;
  end if;
  if exists (
    select 1 from risk_acceptance
    where finding_id = a.finding_id and decision = 'accepted' and ended_at is null
  ) or exists (
    select 1 from findings where id = a.finding_id and status = 'reduced_risk'
  ) or exists (
    select 1 from tickets
    where finding_id = a.finding_id
      and type = 'remediation'
      and status not in ('closed', 'accepted', 'withdrawn')
  ) then
    return 0;
  end if;

  -- Only a ticket this acceptance withdrew; a developer's own withdrawal stays withdrawn.
  select t.id into remediation_id
  from tickets t
  join risk_conversation_entries e
    on e.sync_key = 'remediation-withdrawn::' || a.id::text || '::' || t.id::text
  where t.finding_id = a.finding_id
    and t.type = 'remediation'
    and t.status = 'withdrawn'
    and t.withdrawal_reason = 'Risk accepted'
  order by t.updated_at desc, t.id
  limit 1;
  if remediation_id is null then
    return 0;
  end if;

  perform set_config('app.restoring_remediation', remediation_id::text, true);
  update tickets set status = 'open', updated_at = now() where id = remediation_id;
  perform set_config('app.restoring_remediation', '', true);

  insert into activity_log (actor_id, entity_type, entity_id, action, metadata, sync_key)
  values (a.ended_by, 'ticket', remediation_id, 'remediation_restored',
          jsonb_build_object('acceptance_id', a.id),
          'remediation-restored::' || a.id::text || '::' || remediation_id::text)
  on conflict (sync_key) where sync_key is not null do nothing;
  return 1;
end;
$$;

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

  perform restore_remediation_paused_by_acceptance(a.id);

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

revoke all on function restore_remediation_paused_by_acceptance(uuid)
from public, anon, authenticated;

-- Reopens remediations left withdrawn by acceptances retracted before this fix.
do $$
declare
  acceptance_id uuid;
begin
  for acceptance_id in
    select id from risk_acceptance where end_reason = 'retracted' order by ended_at, id
  loop
    perform restore_remediation_paused_by_acceptance(acceptance_id);
  end loop;
end;
$$;
