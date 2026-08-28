-- Core schema: tables, foreign keys, indexes, constraints.
-- See docs/DATABASE.md for the data-ownership model.

create extension if not exists "pgcrypto";

-- Teams & Profiles

create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('developer', 'security', 'management')),
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  email text not null,
  role text not null default 'developer' check (role in ('developer', 'security', 'cio')),
  team_id uuid references teams (id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_profiles_team_id on profiles (team_id);

-- Applications & Assessments

create table applications (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  name text not null,
  platform text not null check (platform in ('ios', 'android')),
  version text,
  identifier text,
  developer_team_id uuid references teams (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_applications_developer_team_id on applications (developer_team_id);

create table assessments (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,
  application_id uuid not null references applications (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  total_tests integer not null default 0,
  completed_tests integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_assessments_application_id on assessments (application_id);

-- Findings

create table findings (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  application_id uuid not null references applications (id) on delete cascade,
  assessment_id uuid references assessments (id) on delete set null,
  test_id text,
  latest_test_run_id text,
  title text not null,
  description text,
  impact text,
  severity text check (severity in ('critical', 'high', 'medium', 'low', 'info') or severity is null),
  status text not null default 'inconclusive' check (status in ('at_risk', 'reduced_risk', 'inconclusive')),
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_findings_application_id on findings (application_id);
create index idx_findings_assessment_id on findings (assessment_id);
create index idx_findings_status on findings (status);

create table finding_history (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references findings (id) on delete cascade,
  previous_status text check (previous_status in ('at_risk', 'reduced_risk', 'inconclusive') or previous_status is null),
  new_status text not null check (new_status in ('at_risk', 'reduced_risk', 'inconclusive')),
  changed_by uuid references profiles (id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

create index idx_finding_history_finding_id on finding_history (finding_id);

-- Tickets

create table tickets (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references findings (id) on delete cascade,
  application_id uuid not null references applications (id) on delete cascade,
  type text not null check (type in ('remediation', 'risk_acceptance', 'retest_request')),
  status text not null default 'open' check (
    status in (
      'open', 'in_progress', 'fix_submitted', 'retest_requested',
      'retest_in_progress', 'under_review', 'accepted', 'rejected', 'closed'
    )
  ),
  title text not null,
  description text,
  created_by uuid not null references profiles (id) on delete restrict,
  assigned_user_id uuid references profiles (id) on delete set null,
  assigned_team_id uuid references teams (id) on delete set null,
  target_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create index idx_tickets_finding_id on tickets (finding_id);
create index idx_tickets_application_id on tickets (application_id);
create index idx_tickets_status on tickets (status);
create index idx_tickets_created_by on tickets (created_by);

create table ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets (id) on delete cascade,
  author_id uuid not null references profiles (id) on delete restrict,
  message text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index idx_ticket_messages_ticket_id on ticket_messages (ticket_id);

create table ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets (id) on delete cascade,
  message_id uuid references ticket_messages (id) on delete set null,
  uploaded_by uuid not null references profiles (id) on delete restrict,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  created_at timestamptz not null default now()
);

create index idx_ticket_attachments_ticket_id on ticket_attachments (ticket_id);

-- Evidence

create table evidence (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid references findings (id) on delete cascade,
  ticket_id uuid references tickets (id) on delete cascade,
  test_run_id text,
  type text not null check (type in ('image', 'text', 'log', 'json', 'file', 'report')),
  name text not null,
  source text not null default 'dashboard',
  storage_path text,
  external_url text,
  text_content text,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint evidence_has_owner check (finding_id is not null or ticket_id is not null)
);

create index idx_evidence_finding_id on evidence (finding_id);
create index idx_evidence_ticket_id on evidence (ticket_id);

-- Retest & Risk Acceptance workflow

create table retest_runs (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets (id) on delete cascade,
  finding_id uuid not null references findings (id) on delete cascade,
  external_test_run_id text,
  requested_by uuid not null references profiles (id) on delete restrict,
  executed_by uuid references profiles (id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  result text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index idx_retest_runs_ticket_id on retest_runs (ticket_id);
create index idx_retest_runs_finding_id on retest_runs (finding_id);

create table risk_acceptance (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null unique references tickets (id) on delete cascade,
  finding_id uuid not null references findings (id) on delete cascade,
  requested_by uuid not null references profiles (id) on delete restrict,
  reason text not null,
  business_justification text,
  compensating_controls text,
  expires_at timestamptz,
  reviewed_by uuid references profiles (id) on delete set null,
  decision text check (decision in ('pending', 'accepted', 'rejected')),
  review_comment text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index idx_risk_acceptance_finding_id on risk_acceptance (finding_id);

-- Activity log

create table activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles (id) on delete set null,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index idx_activity_log_entity on activity_log (entity_type, entity_id);

-- updated_at maintenance

create function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at before update on profiles
  for each row execute function set_updated_at();
create trigger trg_applications_updated_at before update on applications
  for each row execute function set_updated_at();
create trigger trg_assessments_updated_at before update on assessments
  for each row execute function set_updated_at();
create trigger trg_findings_updated_at before update on findings
  for each row execute function set_updated_at();
create trigger trg_tickets_updated_at before update on tickets
  for each row execute function set_updated_at();

-- New auth.users row -> profiles row (see docs/SUPABASE_SETUP.md#role-assignment)

create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    'developer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
