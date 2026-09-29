-- One conversation per application risk, replacing the per-assessment identity
-- introduced in 0020. See docs/data-model.md for the design.

begin;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'risk_conversations'
      and column_name = 'assessment_id'
  ) then
    alter table risk_conversations rename column assessment_id to origin_assessment_id;
  end if;
end
$$;

alter table tickets
  add column if not exists origin_assessment_id uuid
    references assessments (id) on delete set null;

-- Recorded before the merge below, while each ticket's conversation still names
-- the one assessment it was opened under.
update tickets t
set origin_assessment_id = (
  select a.id
  from assessments a
  where a.application_id = t.application_id
    and a.id = coalesce(
      (
        select c.origin_assessment_id from risk_conversations c
        where c.id = t.risk_conversation_id
      ),
      (select f.assessment_id from findings f where f.id = t.finding_id)
    )
)
where t.origin_assessment_id is null;

alter table risk_conversations
  add column if not exists application_id uuid references applications (id) on delete cascade;

-- Replaced before the backfill below touches a row: the 0020 version guards the
-- column this migration has just renamed, and would fail on every update.
create or replace function enforce_risk_conversation_identity() returns trigger
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

update risk_conversations c
set application_id = a.application_id
from assessments a
where a.id = c.origin_assessment_id
  and c.application_id is null;

alter table risk_conversations alter column application_id set not null;

create or replace function merge_duplicate_risk_conversations() returns integer
language plpgsql as $$
declare
  merged integer;
  stragglers integer;
begin
  create temporary table risk_conversation_merges on commit drop as
  select
    c.id as duplicate_id,
    first_value(c.id) over (
      partition by c.application_id, c.risk_id
      order by c.created_at, c.id
    ) as canonical_id
  from risk_conversations c;

  delete from risk_conversation_merges where duplicate_id = canonical_id;

  update risk_conversation_entries e
  set conversation_id = m.canonical_id
  from risk_conversation_merges m
  where e.conversation_id = m.duplicate_id;

  update retest_runs r
  set conversation_id = m.canonical_id
  from risk_conversation_merges m
  where r.conversation_id = m.duplicate_id;

  update tickets t
  set risk_conversation_id = m.canonical_id
  from risk_conversation_merges m
  where t.risk_conversation_id = m.duplicate_id;

  update risk_conversations c
  set finding_id = (
    select d.finding_id
    from risk_conversation_merges m
    join risk_conversations d on d.id = m.duplicate_id
    where m.canonical_id = c.id and d.finding_id is not null
    order by d.created_at desc, d.id desc
    limit 1
  )
  where c.finding_id is null
    and exists (select 1 from risk_conversation_merges m where m.canonical_id = c.id);

  -- Deleting a conversation cascades to its entries, so nothing goes until
  -- every reference has moved off it.
  select count(*) into stragglers
  from risk_conversation_merges m
  where exists (
      select 1 from risk_conversation_entries e where e.conversation_id = m.duplicate_id
    )
    or exists (select 1 from retest_runs r where r.conversation_id = m.duplicate_id)
    or exists (select 1 from tickets t where t.risk_conversation_id = m.duplicate_id);
  if stragglers > 0 then
    raise exception
      'refusing to remove % merged conversation(s) that still hold references', stragglers;
  end if;

  delete from risk_conversations c
  using risk_conversation_merges m
  where c.id = m.duplicate_id;
  get diagnostics merged = row_count;

  drop table risk_conversation_merges;
  return merged;
end;
$$;

comment on function merge_duplicate_risk_conversations() is
  'Folds every conversation sharing an (application_id, risk_id) into the oldest of the set, moving its entries, retests and ticket links first. Run by migration 0021; kept so the migration''s own logic is what the RLS suite exercises.';

revoke all on function merge_duplicate_risk_conversations() from public;

select merge_duplicate_risk_conversations();

alter table risk_conversations
  drop constraint if exists risk_conversations_unique_per_risk;

alter table risk_conversations
  drop constraint if exists risk_conversations_unique_per_application_risk;
alter table risk_conversations
  add constraint risk_conversations_unique_per_application_risk
  unique (application_id, risk_id);

alter table risk_conversations alter column origin_assessment_id drop not null;

alter table risk_conversations
  drop constraint if exists risk_conversations_assessment_id_fkey;
alter table risk_conversations
  drop constraint if exists risk_conversations_origin_assessment_id_fkey;
alter table risk_conversations
  add constraint risk_conversations_origin_assessment_id_fkey
  foreign key (origin_assessment_id) references assessments (id) on delete set null;

comment on column risk_conversations.origin_assessment_id is
  'The assessment this conversation was first opened under. Navigation and audit context only; the identity is (application_id, risk_id).';

-- 0020 could not place a ticket whose application had several assessments. The
-- ticket names the application and its finding names the risk, so under the new
-- key that mapping is exact rather than a guess.
create or replace function place_unlinked_ticket_conversations() returns void
language plpgsql as $$
begin
  insert into risk_conversations (application_id, risk_id, origin_assessment_id, finding_id)
  select distinct on (t.application_id, f.test_id)
    t.application_id, f.test_id, f.assessment_id, f.id
  from tickets t
  join findings f on f.id = t.finding_id
  where t.risk_conversation_id is null
    and f.test_id is not null
    and f.application_id = t.application_id
  order by t.application_id, f.test_id, f.created_at
  on conflict (application_id, risk_id) do nothing;

  update tickets t
  set risk_conversation_id = c.id
  from findings f
  join risk_conversations c
    on c.application_id = f.application_id and c.risk_id = f.test_id
  where t.finding_id = f.id
    and t.application_id = f.application_id
    and t.risk_conversation_id is null;

  insert into risk_conversation_entries
    (conversation_id, kind, author_id, message, metadata, source_ticket_id, created_at, sync_key)
  select
    t.risk_conversation_id,
    'message',
    m.author_id,
    m.message,
    jsonb_build_object('migrated_from', 'ticket_message'),
    m.ticket_id,
    m.created_at,
    'legacy-ticket-message::' || m.id
  from ticket_messages m
  join tickets t on t.id = m.ticket_id
  where m.migrated_entry_id is null
    and t.risk_conversation_id is not null
  order by m.created_at, m.id
  on conflict (sync_key) where sync_key is not null do nothing;

  update ticket_messages m
  set migrated_entry_id = e.id
  from risk_conversation_entries e
  where e.sync_key = 'legacy-ticket-message::' || m.id
    and m.migrated_entry_id is null;

  insert into risk_conversation_attachments
    (entry_id, uploaded_by, storage_path, file_name, mime_type, created_at, sync_key)
  select
    m.migrated_entry_id, a.uploaded_by, a.storage_path, a.file_name, a.mime_type, a.created_at,
    'legacy-ticket-attachment::' || a.id
  from ticket_attachments a
  join ticket_messages m on m.id = a.message_id
  where a.migrated_attachment_id is null
    and m.migrated_entry_id is not null
  on conflict (sync_key) where sync_key is not null do nothing;

  update ticket_attachments a
  set migrated_attachment_id = r.id
  from risk_conversation_attachments r
  where r.sync_key = 'legacy-ticket-attachment::' || a.id
    and a.migrated_attachment_id is null;
end;
$$;

comment on function place_unlinked_ticket_conversations() is
  'Links a remediation ticket with no conversation to its application''s conversation for the risk its finding names, creating it if needed, and migrates that ticket''s archived messages and their attachments. Idempotent. Run by migration 0021; kept so the migration''s own logic is what the RLS suite exercises.';

revoke all on function place_unlinked_ticket_conversations() from public;

select place_unlinked_ticket_conversations();

update retest_runs r
set conversation_id = t.risk_conversation_id
from tickets t
where t.id = r.ticket_id
  and r.conversation_id is null
  and t.risk_conversation_id is not null;

create or replace function enforce_ticket_update_permissions() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  developer_statuses constant text[] :=
    array['open', 'in_progress', 'fix_submitted', 'retest_requested', 'withdrawn'];
  withdrawable_from constant text[] :=
    array['open', 'in_progress', 'fix_submitted', 'rejected'];
  security_finalised constant text[] := array['closed', 'accepted'];
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

create or replace function can_access_risk_conversation(c_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_access_application(application_id) from risk_conversations where id = c_id;
$$;

alter policy risk_conversations_select on risk_conversations
  using (can_access_application(application_id));

alter policy risk_conversations_insert on risk_conversations
  with check (
    (has_role('developer') or has_role('security'))
    and can_access_application(application_id)
  );

alter policy risk_conversations_update on risk_conversations
  using (
    (has_role('developer') or has_role('security'))
    and can_access_application(application_id)
  )
  with check (
    (has_role('developer') or has_role('security'))
    and can_access_application(application_id)
  );

-- Duplicates predating this rule are closed out rather than left blocking the
-- index; the newest survives and the older records are kept.
update retest_runs r
set status = 'failed',
    result = coalesce(
      r.result,
      'Superseded by a newer reassessment request for the same risk.'
    ),
    completed_at = coalesce(r.completed_at, now())
where r.status in ('queued', 'running')
  and r.conversation_id is not null
  and exists (
    select 1 from retest_runs newer
    where newer.conversation_id = r.conversation_id
      and newer.status in ('queued', 'running')
      and (newer.created_at, newer.id) > (r.created_at, r.id)
  );

create unique index if not exists retest_runs_one_active_per_conversation
  on retest_runs (conversation_id)
  where conversation_id is not null and status in ('queued', 'running');

-- A legacy ticket with no conversation link is let through: there is nothing for
-- it to contradict.
create or replace function enforce_retest_request_permissions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
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

-- The finding status, its history row and the conversation event are one
-- decision, so they are written in one statement.
create or replace function classify_risk(
  p_finding_id uuid,
  p_conversation_id uuid,
  p_status text,
  p_reason text
) returns findings
language plpgsql security definer set search_path = public as $$
declare
  f findings;
  c risk_conversations;
  trimmed text := btrim(coalesce(p_reason, ''));
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
    raise exception 'this risk conversation no longer exists';
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
  );

  insert into activity_log (actor_id, entity_type, entity_id, action, metadata)
  values (
    auth.uid(), 'finding', f.id, 'finding_status_changed',
    jsonb_build_object('previous_status', f.status, 'new_status', p_status)
  );

  select * into f from findings where id = f.id;
  return f;
end;
$$;

revoke all on function classify_risk(uuid, uuid, text, text) from public;
grant execute on function classify_risk(uuid, uuid, text, text) to authenticated;

commit;
