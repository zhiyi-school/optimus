-- A real-time conversation thread scoped to an assessment (not a finding or
-- ticket) — shown on both the Assessment Detail and per-test pages, so
-- Security/Developer can discuss the assessment as a whole while it's in
-- progress, before any findings/tickets necessarily exist yet. Mirrors the
-- ticket_messages table/RLS pattern exactly (see docs/DATABASE.md).

create table assessment_messages (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments (id) on delete cascade,
  author_id uuid not null references profiles (id) on delete restrict,
  message text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index idx_assessment_messages_assessment_id on assessment_messages (assessment_id);

create function can_access_assessment(a_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_access_application(application_id) from assessments where id = a_id;
$$;

alter table assessment_messages enable row level security;

create policy assessment_messages_select on assessment_messages for select to authenticated
  using (can_access_assessment(assessment_id));

create policy assessment_messages_insert on assessment_messages for insert to authenticated
  with check (
    author_id = auth.uid()
    and (has_role('developer') or has_role('security'))
    and can_access_assessment(assessment_id)
  );
