-- Fresh-install baseline: extensions, tables, keys, constraints and indexes.
-- See docs/database-maintenance.md for how the baseline relates to fixes/.

create extension if not exists "pgcrypto";

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
  team_id uuid references teams (id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  roles text[] not null default array['developer'],
  constraint profiles_roles_nonempty check (array_length(roles, 1) > 0),
  constraint profiles_roles_valid check (roles <@ array['developer', 'security', 'cio', 'admin'])
);

create index idx_profiles_team_id on profiles (team_id);

create table applications (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  name text not null,
  platform text not null check (platform in ('ios', 'android')),
  version text,
  identifier text,
  developer_team_id uuid references teams (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  app_type text,
  owner_name text,
  owner_email text,
  developer_contact_name text,
  developer_contact_email text,
  contact_emails text[] not null default '{}',
  provisioning_status text check (provisioning_status in ('pending', 'ready', 'failed')),
  provisioning_error text,
  artifact_sha256 text check (artifact_sha256 is null or artifact_sha256 ~ '^[0-9a-f]{64}$'),
  icon_ref text check (icon_ref is null or icon_ref ~ '^icons/[0-9a-f]{64}\.png$'),
  icon_extraction_status text check (icon_extraction_status in ('available', 'unavailable', 'failed'))
);

create index idx_applications_developer_team_id on applications (developer_team_id);

create table assessments (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,
  application_id uuid not null references applications (id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'waiting', 'running', 'completed', 'failed')),
  total_tests integer not null default 0,
  completed_tests integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  app_version text,
  latest_run_id text
);

comment on column assessments.app_version is
  'The app build version this assessment tested, written by the dashboard sync from the run. Null until a run is synced, and on assessments synced before versions were recorded.';

comment on column assessments.latest_run_id is
  'The newest automation run applied to this assessment: its own run, then any rerun of one of its risks. The dashboard sync skips an older run, so a replayed report never overwrites newer progress. Null until a run is synced.';

create index idx_assessments_application_id on assessments (application_id);

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
  status text not null default 'inconclusive'
    check (status in ('at_risk', 'reduced_risk', 'inconclusive')),
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
  previous_status text
    check (previous_status in ('at_risk', 'reduced_risk', 'inconclusive') or previous_status is null),
  new_status text not null check (new_status in ('at_risk', 'reduced_risk', 'inconclusive')),
  changed_by uuid references profiles (id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  sync_key text
);

create index idx_finding_history_finding_id on finding_history (finding_id);
-- The sync worker's idempotency key; dashboard-written rows leave it null.
create unique index finding_history_sync_key_idx on finding_history (sync_key) where sync_key is not null;

create table risk_conversations (
  id uuid primary key default gen_random_uuid(),
  origin_assessment_id uuid references assessments (id) on delete set null,
  risk_id text not null,
  finding_id uuid references findings (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  application_id uuid not null references applications (id) on delete cascade,
  constraint risk_conversations_unique_per_application_risk unique (application_id, risk_id)
);

create index idx_risk_conversations_assessment_id on risk_conversations (origin_assessment_id);
create index idx_risk_conversations_finding_id on risk_conversations (finding_id);

comment on column risk_conversations.origin_assessment_id is
  'The assessment this conversation was first opened under. Navigation and audit context only; the identity is (application_id, risk_id).';

create table tickets (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid references findings (id) on delete cascade,
  application_id uuid not null references applications (id) on delete cascade,
  type text not null
    check (type in ('remediation', 'risk_acceptance', 'retest_request', 'app_provisioning')),
  status text not null default 'open' check (status in (
    'open', 'in_progress', 'retest_requested', 'retest_in_progress', 'under_review',
    'accepted', 'rejected', 'withdrawn', 'closed'
  )),
  title text not null,
  description text,
  created_by uuid not null references profiles (id) on delete restrict,
  assigned_user_id uuid references profiles (id) on delete set null,
  assigned_team_id uuid references teams (id) on delete set null,
  target_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  withdrawn_at timestamptz,
  withdrawn_by uuid references profiles (id) on delete set null,
  withdrawal_reason text,
  risk_conversation_id uuid references risk_conversations (id) on delete set null,
  origin_assessment_id uuid references assessments (id) on delete set null,
  -- A logical reference into the backend playbook catalogue, so there is no foreign key.
  selected_control_id text,
  constraint tickets_selected_control_id_not_blank
    check (selected_control_id is null or btrim(selected_control_id) <> '')
);

create index idx_tickets_application_id on tickets (application_id);
create index idx_tickets_created_by on tickets (created_by);
create index idx_tickets_finding_id on tickets (finding_id);
create index idx_tickets_finding_remediation on tickets (finding_id, status) where type = 'remediation';
create index idx_tickets_risk_conversation_id on tickets (risk_conversation_id);
create index idx_tickets_status on tickets (status);

create table risk_conversation_entries (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references risk_conversations (id) on delete cascade,
  -- `fix_submitted` stays legal so recorded history remains valid; no client can write it.
  kind text not null check (kind in (
    'message', 'classification_changed', 'retest_requested', 'retest_started',
    'retest_completed', 'retest_failed', 'retest_withdrawn', 'remediation_started',
    'remediation_withdrawn', 'fix_submitted', 'risk_accepted', 'risk_acceptance_retracted',
    'risk_acceptance_ended'
  )),
  author_id uuid references profiles (id) on delete set null,
  message text,
  metadata jsonb not null default '{}',
  source_ticket_id uuid references tickets (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Breaks ties between entries created in the same transaction.
  seq bigint generated always as identity,
  sync_key text
);

create index idx_risk_conversation_entries_conversation
  on risk_conversation_entries (conversation_id, created_at, seq);
create unique index risk_conversation_entries_sync_key_idx
  on risk_conversation_entries (sync_key) where sync_key is not null;

create table risk_conversation_attachments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references risk_conversation_entries (id) on delete cascade,
  uploaded_by uuid not null references profiles (id) on delete restrict,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  created_at timestamptz not null default now(),
  sync_key text,
  storage_provider text not null default 'supabase' check (storage_provider in ('supabase', 'server')),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  -- An opaque key inside its provider, never a host filesystem path.
  constraint risk_conversation_attachments_storage_path_relative check (
    storage_path <> '' and storage_path !~ '^/' and storage_path !~ '(^|/)\.\.(/|$)'
  )
);

create index idx_risk_conversation_attachments_entry on risk_conversation_attachments (entry_id);
create unique index risk_conversation_attachments_sync_key_idx
  on risk_conversation_attachments (sync_key) where sync_key is not null;

comment on column risk_conversation_attachments.storage_provider is
  'supabase = object at storage_path in the private ticket-attachments bucket; server = automation-server key at storage_path. Access is decided by can_access_risk_conversation on the owning entry, never by uploaded_by.';
comment on column risk_conversation_attachments.size_bytes is
  'Size of the stored file in bytes, recorded at upload. Null for rows uploaded before this column existed.';

create table ticket_controls (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets (id) on delete cascade,
  control_id text not null,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'completed', 'needs_changes')),
  completed_at timestamptz,
  completed_by uuid references profiles (id) on delete set null,
  developer_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticket_controls_unique_per_ticket unique (ticket_id, control_id)
);

create index idx_ticket_controls_ticket_id on ticket_controls (ticket_id);

create table ticket_control_steps (
  id uuid primary key default gen_random_uuid(),
  ticket_control_id uuid not null references ticket_controls (id) on delete cascade,
  -- The playbook's stable step id; titles and ordering come from the backend.
  step_key text not null,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'completed', 'needs_changes')),
  completed_at timestamptz,
  completed_by uuid references profiles (id) on delete set null,
  developer_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticket_control_steps_unique_per_control unique (ticket_control_id, step_key)
);

create index idx_ticket_control_steps_ticket_control_id on ticket_control_steps (ticket_control_id);

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

create table retest_runs (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references tickets (id) on delete cascade,
  finding_id uuid not null references findings (id) on delete cascade,
  external_test_run_id text,
  requested_by uuid not null references profiles (id) on delete restrict,
  executed_by uuid references profiles (id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  result text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  conversation_id uuid references risk_conversations (id) on delete cascade,
  cancelled_at timestamptz,
  cancelled_by uuid references profiles (id) on delete set null,
  cancellation_reason text,
  previous_ticket_status text
    check (previous_ticket_status is null or previous_ticket_status in ('open', 'in_progress', 'rejected')),
  submission_id uuid,
  constraint retest_runs_cancellation_fields check (
    case
      when status = 'cancelled' then
        cancelled_at is not null and cancelled_by is not null
        and coalesce(btrim(cancellation_reason), '') <> ''
      else cancelled_at is null and cancelled_by is null and cancellation_reason is null
    end
  ),
  constraint retest_runs_has_owner check (conversation_id is not null or ticket_id is not null)
);

create index idx_retest_runs_conversation_id on retest_runs (conversation_id);
create index idx_retest_runs_finding_id on retest_runs (finding_id);
create index idx_retest_runs_ticket_id on retest_runs (ticket_id);
-- Several requests may be queued for a risk, but only one runs at a time.
create unique index retest_runs_one_running_per_conversation
  on retest_runs (conversation_id) where conversation_id is not null and status = 'running';
-- A retried submission resolves to the request it already created.
create unique index retest_runs_submission_identity
  on retest_runs (conversation_id, requested_by, submission_id)
  where conversation_id is not null and submission_id is not null;

comment on column retest_runs.submission_id is
  'Identifies one intentional submission. A retry of that submission carries the same value and resolves to the same request; a new Send carries a new one. Null on rows created before this migration.';

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
  reviewed_at timestamptz,
  conversation_id uuid references risk_conversations (id) on delete set null,
  accepted_run_id text,
  accepted_status text check (accepted_status in ('at_risk', 'reduced_risk', 'inconclusive')),
  submission_id uuid,
  ended_at timestamptz,
  ended_by uuid references profiles (id) on delete set null,
  end_reason text check (end_reason in ('retracted', 'resolved')),
  end_note text,
  constraint risk_acceptance_end_fields check (
    (ended_at is null) = (end_reason is null)
    and (end_reason is distinct from 'retracted' or coalesce(btrim(end_note), '') <> '')
  )
);

create index idx_risk_acceptance_finding_id on risk_acceptance (finding_id);
-- One acceptance is in force per risk at a time.
create unique index risk_acceptance_one_active_per_finding
  on risk_acceptance (finding_id) where decision = 'accepted' and ended_at is null;
-- A retried acceptance resolves to the acceptance it already made.
create unique index risk_acceptance_submission_identity
  on risk_acceptance (conversation_id, requested_by, submission_id)
  where conversation_id is not null and submission_id is not null;

comment on column risk_acceptance.end_reason is
  'Why an accepted risk stopped being accepted: retracted by a developer, or resolved when its result became Reduced Risk. Null while the acceptance is in force.';

create table activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles (id) on delete set null,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  metadata jsonb,
  created_at timestamptz not null default now(),
  sync_key text
);

create index idx_activity_log_entity on activity_log (entity_type, entity_id);
create unique index activity_log_sync_key_idx on activity_log (sync_key) where sync_key is not null;

create table assessment_run_requests (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments (id) on delete cascade,
  application_id uuid not null references applications (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  status text not null default 'queued' check (status in (
    'queued', 'waiting', 'claimed', 'running', 'completed', 'failed', 'cancelled'
  )),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  worker_id text,
  blocker_code text,
  last_error text,
  requested_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  run_id text,
  build_version text
);

comment on column assessment_run_requests.run_id is
  'The automation run the worker started for this request, set when the request completes. Null until a run starts, and on requests that never started one.';

comment on column assessment_run_requests.build_version is
  'The iOS build version the run must test. Null lets the automation host test the app''s highest version.';

create index idx_assessment_run_requests_assessment on assessment_run_requests (assessment_id);
create index idx_assessment_run_requests_claimable on assessment_run_requests (status, next_attempt_at);
-- At most one outstanding run per assessment.
create unique index assessment_run_requests_one_active on assessment_run_requests (assessment_id)
  where status in ('queued', 'waiting', 'claimed', 'running');
