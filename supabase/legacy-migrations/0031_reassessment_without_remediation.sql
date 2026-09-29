-- A reassessment no longer needs a remediation ticket behind it. See
-- docs/roles-and-workflows.md for how the two workflows relate.

-- ---------------------------------------------------------------------------
-- A developer may ask from the risk conversation alone
-- ---------------------------------------------------------------------------

create or replace function enforce_retest_request_permissions() returns trigger
language plpgsql security definer set search_path = public as $$
declare
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
  'Gates a reassessment request on role and application access. A developer may ask from the risk conversation alone; a request that does name a ticket must name a remediation ticket opened against this risk. Neither remediation state, a selected approach, nor progress is a condition, and several requests may be outstanding at once. previous_ticket_status records only a pre-queue state, so withdrawing the last outstanding request restores something meaningful.';

-- ---------------------------------------------------------------------------
-- Withdrawal restores a remediation only when there is one
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

revoke all on function withdraw_reassessment(uuid, text) from public, anon;
grant execute on function withdraw_reassessment(uuid, text) to authenticated;
