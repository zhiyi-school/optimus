-- One canonical conversation per assessment risk, replacing the assessment-wide
-- thread (0008) and the per-ticket thread (0001).
--
-- The conversation is scoped to (assessment_id, risk_id) — not to an assessment
-- as a whole, and not to a ticket. A risk can be discussed before any finding
-- exists, so finding_id is nullable and linked later. Structured workflow
-- events (classification changes, retest lifecycle, remediation milestones)
-- share one append-only, chronologically ordered feed with ordinary messages.
--
-- Legacy message tables are kept as archived data. Their write and read
-- policies are dropped, so nothing in the dashboard can add to them or show
-- them; destructive removal of the archived rows waits for an agreed retention
-- period and explicit approval.

-- ---------------------------------------------------------------------------
-- 1. Canonical conversation and its entries
-- ---------------------------------------------------------------------------

create table risk_conversations (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments (id) on delete cascade,
  risk_id text not null,
  finding_id uuid references findings (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint risk_conversations_unique_per_risk unique (assessment_id, risk_id)
);

create index idx_risk_conversations_assessment_id on risk_conversations (assessment_id);
create index idx_risk_conversations_finding_id on risk_conversations (finding_id);

create table risk_conversation_entries (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references risk_conversations (id) on delete cascade,
  kind text not null check (
    kind in (
      'message', 'classification_changed', 'retest_requested', 'retest_started',
      'retest_completed', 'retest_failed', 'remediation_started',
      'remediation_withdrawn', 'fix_submitted'
    )
  ),
  author_id uuid references profiles (id) on delete set null,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  source_ticket_id uuid references tickets (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Insertion order, so two entries written in one transaction still render in
  -- the order they happened rather than by a random id tie-break.
  seq bigint generated always as identity,
  sync_key text
);

create index idx_risk_conversation_entries_conversation
  on risk_conversation_entries (conversation_id, created_at, seq);

create unique index risk_conversation_entries_sync_key_idx
  on risk_conversation_entries (sync_key)
  where sync_key is not null;

create table risk_conversation_attachments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references risk_conversation_entries (id) on delete cascade,
  uploaded_by uuid not null references profiles (id) on delete restrict,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  created_at timestamptz not null default now(),
  sync_key text
);

create index idx_risk_conversation_attachments_entry on risk_conversation_attachments (entry_id);

create unique index risk_conversation_attachments_sync_key_idx
  on risk_conversation_attachments (sync_key)
  where sync_key is not null;

create trigger trg_risk_conversations_updated_at before update on risk_conversations
  for each row execute function set_updated_at();

create function touch_risk_conversation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update risk_conversations set updated_at = now() where id = new.conversation_id;
  return new;
end;
$$;

create trigger trg_touch_risk_conversation after insert on risk_conversation_entries
  for each row execute function touch_risk_conversation();

-- assessment_id and risk_id are the conversation's identity; only the finding
-- link may be filled in later.
create function enforce_risk_conversation_identity() returns trigger
language plpgsql as $$
begin
  if new.assessment_id is distinct from old.assessment_id
    or new.risk_id is distinct from old.risk_id then
    raise exception 'a risk conversation cannot be moved to another assessment or risk';
  end if;
  return new;
end;
$$;

create trigger trg_enforce_risk_conversation_identity before update on risk_conversations
  for each row execute function enforce_risk_conversation_identity();

-- ---------------------------------------------------------------------------
-- 2. Workflow links: tickets and retests point at the conversation
-- ---------------------------------------------------------------------------

alter table tickets
  add column risk_conversation_id uuid references risk_conversations (id) on delete set null;

create index idx_tickets_risk_conversation_id on tickets (risk_conversation_id);

alter table retest_runs
  add column conversation_id uuid references risk_conversations (id) on delete cascade;

-- A retest is now conversation-owned; a ticket-originated one keeps its ticket
-- reference so the linked remediation still transitions.
alter table retest_runs alter column ticket_id drop not null;

alter table retest_runs add constraint retest_runs_has_owner
  check (conversation_id is not null or ticket_id is not null);

create index idx_retest_runs_conversation_id on retest_runs (conversation_id);

-- ---------------------------------------------------------------------------
-- 3. Access control
-- ---------------------------------------------------------------------------

create function can_access_risk_conversation(c_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_access_assessment(assessment_id) from risk_conversations where id = c_id;
$$;

alter table risk_conversations enable row level security;
alter table risk_conversation_entries enable row level security;
alter table risk_conversation_attachments enable row level security;

create policy risk_conversations_select on risk_conversations for select to authenticated
  using (can_access_assessment(assessment_id));

create policy risk_conversations_insert on risk_conversations for insert to authenticated
  with check (
    (has_role('developer') or has_role('security'))
    and can_access_assessment(assessment_id)
  );

create policy risk_conversations_update on risk_conversations for update to authenticated
  using (
    (has_role('developer') or has_role('security'))
    and can_access_assessment(assessment_id)
  )
  with check (
    (has_role('developer') or has_role('security'))
    and can_access_assessment(assessment_id)
  );

create policy risk_conversation_entries_select on risk_conversation_entries
  for select to authenticated
  using (can_access_risk_conversation(conversation_id));

-- Classification and retest execution stay security-owned; a developer can
-- talk, request a reassessment, and record their own remediation milestones.
-- Entries with no author come from the automation worker, which uses the
-- service role and is not subject to these policies.
create policy risk_conversation_entries_insert on risk_conversation_entries
  for insert to authenticated
  with check (
    can_access_risk_conversation(conversation_id)
    and author_id = auth.uid()
    and (
      (
        kind in (
          'message', 'retest_requested', 'remediation_started',
          'remediation_withdrawn', 'fix_submitted'
        )
        and (has_role('developer') or has_role('security'))
      )
      or (
        kind in (
          'classification_changed', 'retest_started', 'retest_completed', 'retest_failed'
        )
        and has_role('security')
      )
    )
  );

create policy risk_conversation_attachments_select on risk_conversation_attachments
  for select to authenticated
  using (
    exists (
      select 1 from risk_conversation_entries e
      where e.id = risk_conversation_attachments.entry_id
        and can_access_risk_conversation(e.conversation_id)
    )
  );

create policy risk_conversation_attachments_insert on risk_conversation_attachments
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and (has_role('developer') or has_role('security'))
    and exists (
      select 1 from risk_conversation_entries e
      where e.id = risk_conversation_attachments.entry_id
        and can_access_risk_conversation(e.conversation_id)
    )
  );

-- No update or delete policies on entries or attachments: the feed is an
-- append-only audit trail and RLS denies whatever no policy allows.

-- ---------------------------------------------------------------------------
-- 4. Retest authority
-- ---------------------------------------------------------------------------

-- Opening a risk conversation must not become a way around the remediation
-- workflow: a developer's reassessment request still has to come from their own
-- remediation ticket with a fix submitted (or one security sent back).
create function enforce_retest_request_permissions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
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

create trigger trg_enforce_retest_request_permissions before insert on retest_runs
  for each row execute function enforce_retest_request_permissions();

alter policy retest_runs_select on retest_runs
  using (
    (ticket_id is not null and can_access_ticket(ticket_id))
    or (conversation_id is not null and can_access_risk_conversation(conversation_id))
  );

alter policy retest_runs_insert on retest_runs
  with check (
    requested_by = auth.uid()
    and (has_role('developer') or has_role('security'))
    and (
      (ticket_id is not null and can_access_ticket(ticket_id))
      or (ticket_id is null and conversation_id is not null
          and can_access_risk_conversation(conversation_id))
    )
  );

-- A ticket's conversation reference is immutable workflow context, so it is
-- recorded once — by anyone, including security — and never repointed.
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

-- ---------------------------------------------------------------------------
-- 5. Conversation attachments in storage
-- ---------------------------------------------------------------------------

-- New uploads live under `conversation-<id>/`; a migrated ticket attachment
-- keeps the `<ticket-id>/` path it was uploaded to, so both must resolve.
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

alter policy ticket_attachments_object_select on storage.objects
  using (bucket_id = 'ticket-attachments' and can_access_attachment_object(name));

alter policy ticket_attachments_object_insert on storage.objects
  with check (
    bucket_id = 'ticket-attachments'
    and (has_role('developer') or has_role('security'))
    and can_access_attachment_object(name)
  );

drop function can_access_ticket_object(text);

-- ---------------------------------------------------------------------------
-- 6. Historical messages
-- ---------------------------------------------------------------------------

-- Migration bookkeeping, so the data migration below can be re-run without
-- duplicating anything and so an unmigrated record stays visibly unmigrated.
alter table ticket_messages
  add column migrated_entry_id uuid references risk_conversation_entries (id) on delete set null;
alter table ticket_attachments
  add column migrated_attachment_id uuid
    references risk_conversation_attachments (id) on delete set null;

-- A ticket's risk conversation can only be derived where the mapping is
-- unambiguous: the finding names a risk, and the application has exactly one
-- assessment, so there is no question which assessment the ticket belongs to.
-- A finding's assessment_id follows the newest run that produced it, so it must
-- not be used to place an older ticket. Anything ambiguous is left unlinked
-- rather than guessed, and its messages stay in the archived table.
insert into risk_conversations (assessment_id, risk_id, finding_id)
select distinct on (a.id, f.test_id) a.id, f.test_id, f.id
from tickets t
join findings f on f.id = t.finding_id
join assessments a on a.application_id = t.application_id
where t.risk_conversation_id is null
  and f.test_id is not null
  and (select count(*) from assessments x where x.application_id = t.application_id) = 1
order by a.id, f.test_id, f.created_at
on conflict (assessment_id, risk_id) do nothing;

update tickets t
set risk_conversation_id = c.id
from findings f
join assessments a on a.application_id = f.application_id
join risk_conversations c on c.assessment_id = a.id and c.risk_id = f.test_id
where t.finding_id = f.id
  and t.application_id = f.application_id
  and t.risk_conversation_id is null
  and (select count(*) from assessments x where x.application_id = t.application_id) = 1;

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

-- Assessment-wide messages name no risk, so there is no correct risk to move
-- them to. They are left where they are rather than assigned to an arbitrary
-- one, and no longer rendered anywhere.

-- ---------------------------------------------------------------------------
-- 7. Retire the legacy conversation tables
-- ---------------------------------------------------------------------------

drop policy assessment_messages_insert on assessment_messages;
drop policy assessment_messages_select on assessment_messages;
drop policy ticket_messages_insert on ticket_messages;
drop policy ticket_messages_select on ticket_messages;
drop policy ticket_attachments_insert on ticket_attachments;
drop policy ticket_attachments_select on ticket_attachments;

comment on table assessment_messages is
  'Archived. Superseded by risk_conversation_entries; no policy grants access. Retain until an agreed retention period has passed and removal is explicitly approved.';
comment on table ticket_messages is
  'Archived. Migrated into risk_conversation_entries where the ticket-to-risk mapping was unambiguous; migrated_entry_id records which. Retain until an agreed retention period has passed and removal is explicitly approved.';
comment on table ticket_attachments is
  'Archived. Message attachments migrated into risk_conversation_attachments; migrated_attachment_id records which. Attachments never linked to a message were not migrated. Retain until an agreed retention period has passed and removal is explicitly approved.';

-- Backfill the retest link now that conversations exist.
update retest_runs r
set conversation_id = t.risk_conversation_id
from tickets t
where t.id = r.ticket_id
  and r.conversation_id is null
  and t.risk_conversation_id is not null;
