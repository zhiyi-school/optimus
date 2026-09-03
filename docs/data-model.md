# Database Design Notes

The schema itself lives in `supabase/migrations/` (`0001_schema.sql` /
`0002_rls.sql` / `0003_storage.sql` / `0004_application_contacts.sql` /
`0005_admin_policies.sql` / `0006_multi_role_admin.sql` /
`0007_app_provisioning.sql` / `0008_assessment_messages.sql` /
`0009_application_contact_emails.sql` / `0010_applications_delete.sql` /
`0011_application_provisioning.sql` / `0012_dashboard_metrics_rpc.sql` /
`0013_sync_idempotency_keys.sql` / `0014_dashboard_metrics_grants.sql` /
`0015_dashboard_metrics_revoke_anon.sql` / `0016_application_icon_refs.sql` /
`0017_ticket_controls.sql` / `0018_ticket_withdrawal.sql` /
`0019_live_playbook_progress.sql` / `0020_risk_conversations.sql` /
`0021_application_risk_conversations.sql` /
`0022_selected_remediation_control.sql` /
`0023_assessment_run_requests.sql`) —
this doc covers the *why* behind a few decisions that aren't obvious from
reading the SQL alone.

## Row Level Security

Frontend capability checks (`src/auth/permissions.ts`) are UX only. The
policies in `0002_rls.sql` (as amended by later RLS migrations) are the actual
authorization boundary.

- **Role checks go through `SECURITY DEFINER` helper functions**
  (`has_role(role)`, `current_team_id()`, `can_access_application()`,
  `can_access_ticket()`) instead of inline subqueries on `profiles`. A
  policy on `profiles` that queried `profiles` directly would recurse; a
  `SECURITY DEFINER` function sidesteps that. `has_role('security')`
  replaced the original single-value `current_app_role() = 'security'`
  pattern when `profiles.role` became `profiles.roles` (an array) in
  `0006_multi_role_admin.sql` — a user can hold more than one role, so
  every policy checks *membership* in the caller's roles, not equality
  against one value.
- **Ticket status transitions are constrained in the database, not just in
  the UI.** RLS by itself only decides *who* may write to *which rows*, and
  `tickets_update` deliberately lets a developer write to a ticket their team
  owns — which meant the generic status mutation could set `closed` and skip
  the reassessment workflow entirely. `enforce_ticket_update_permissions`
  (`0017_ticket_controls.sql`) closes that: a caller holding neither
  `security` nor `admin` may only move a ticket to `open`, `in_progress`,
  `fix_submitted` or `retest_requested`, cannot touch `closed_at`, and cannot
  change `type`, `finding_id`, `application_id`, `created_by` or either
  assignment column. It is a guardrail on the security-owned transitions, not
  a full state machine — which step is *sensible* next is still the
  application's business (`src/lib/resolve.ts`, `src/components/ticket-actions.tsx`).
  Like `prevent_role_escalation`, it only applies when
  `auth.role() = 'authenticated'`, so the automation sync worker — which holds
  the service-role key and moves a ticket to `under_review` when a retest lands
  — is unaffected.
- **`id` can never change, for anyone, through the app.** The
  `prevent_role_escalation` trigger on `profiles` raises an exception
  unconditionally whenever `auth.role() = 'authenticated'` — i.e. via the
  anon-key client, no matter who's asking.
- **No one can change their own `roles` through the app — not even an
  admin.** Same trigger: changing another user's `roles` requires
  `has_role('admin')`; changing *your own* `roles` is blocked outright,
  full stop, so a single admin session can grant roles to other accounts
  but can never escalate or quietly de-escalate itself. See
  [SUPABASE_SETUP.md](./setup.md#role-assignment) for how you
  bootstrap the first admin (direct SQL — there's no other way in, by
  design).
- **`is_active` is looser**: any `admin` can toggle it for *any* account,
  including their own — suspending/reinstating only gates access a role
  already implies, it can't grant a new privilege the way a `roles` change
  could, so the self-change restriction doesn't apply to it.
- **Application deletes are explicit and privileged.** `0010` adds an
  `applications_delete` policy for `security` or `admin` users only, used
  for duplicate cleanup from the app-add flow. Cascading deletes are
  expected from the existing foreign keys.
- **Conversation access resolves through the application.**
  `can_access_risk_conversation()` reads the conversation's own
  `application_id` and chains to `can_access_application()`, so team scoping on
  applications carries through to every conversation with no separate rule to
  keep in sync.
- **Dashboard metrics are still RLS-scoped.** `dashboard_metrics()` in
  `0012` is granted only to authenticated users and queries the base tables
  without `SECURITY DEFINER`, so each count is limited by the caller's
  existing RLS visibility.

## Risk conversations

Every application feature-risk has one canonical conversation, replacing the
assessment-wide thread (`0008`) and the per-ticket thread (`0001`).
`risk_conversations` is keyed `unique (application_id, risk_id)`, and
`risk_conversation_entries` holds both ordinary messages and structured workflow
events in one feed.

- **The conversation belongs to the application, not to one assessment.** An
  application is assessed repeatedly; keying the thread to an assessment
  (`0020`) restarted the discussion on every run. `risk_id` is the automation
  catalogue's risk/test identifier — the same value as `findings.test_id` — so
  opening the same risk from any assessment of that application reaches the same
  thread, and a new assessment never opens a second one.
- **Assessment context is explicit rather than structural.**
  `risk_conversations.origin_assessment_id` records the assessment the thread
  was first opened under, and `tickets.origin_assessment_id` the one a
  remediation was raised against. Both are navigation and audit context only.
  Both are write-once — a finding's own `assessment_id` follows the newest run,
  so it cannot say where an older ticket belongs — and both are cleared rather
  than blocked when their assessment is deleted, which is what their foreign
  keys do. A conversation outlives any one run.
- **A conversation can exist before a finding does.** `finding_id` is nullable
  and filled in when a finding for that risk appears, so a risk can be
  discussed while it is still being tested.
- **Ordering is by `created_at` then `seq`.** `seq` is an identity column, so
  two entries written in one transaction — a classification change and its
  reason, say — still render in the order they happened rather than by a random
  id tie-break. Merging two threads carries both values across untouched, so the
  merged feed still reads in the order things actually happened.
- **The feed is append-only.** There are `select` and `insert` policies and no
  `update` or `delete` policy on entries or attachments, and RLS denies whatever
  no policy allows. Not even security can rewrite a past workflow event.
- **Who may write what is decided by `kind`.** `classification_changed`,
  `retest_started`, `retest_completed` and `retest_failed` require
  `has_role('security')`; `message`, `retest_requested`, `remediation_started`,
  `remediation_withdrawn` and `fix_submitted` accept `developer` or `security`.
  Every authenticated insert must set `author_id = auth.uid()`, so nobody can
  post under another name. Entries with no author come from the sync worker,
  which holds the service-role key and is not subject to these policies.
- **`metadata` carries only what an event summary needs.** A classification
  change stores its previous and new status; a retest event stores the run
  timestamp. No copy of a finding, ticket, evidence or playbook content lives
  there, and the dashboard never renders the raw value.
- **Automated test history is combined in the frontend, never copied in.** The
  runs shown alongside the discussion come from the automation backend's
  `/apps/{app}/risks/{risk}/history` endpoint and are merged with the stored
  entries by `src/lib/conversation-timeline.ts` at render time. The automation
  host stays their only source of truth, so nothing has to be kept in step.
- **Classification is one server-side operation.** `classify_risk()` writes the
  finding's status, its `finding_history` row, the `classification_changed`
  entry and the activity-log row in a single statement, and refuses a caller
  without `has_role('security')`, an empty reason, or a finding belonging to a
  different application risk than the conversation it was called from. Driving
  those writes from the browser left a window in which the finding could change
  without the conversation ever recording who changed it or why.
- **A ticket records the conversation it was opened against, once.**
  `tickets.risk_conversation_id` is immutable for everyone once set — the
  trigger refuses to repoint it even for security.
- **A retest belongs to the conversation, and optionally to a ticket.**
  `retest_runs.conversation_id` was added and `ticket_id` made nullable, with
  `check (conversation_id is not null or ticket_id is not null)`. Security can
  run a retest with no remediation behind it; a ticket-originated request keeps
  its ticket so the linked remediation still transitions.
- **One reassessment is in flight per risk.** A partial unique index on
  `retest_runs (conversation_id) where status in ('queued', 'running')` makes
  that the database's rule rather than the UI's, so two people cannot queue the
  same reassessment twice.
- **Opening a conversation is not a way around the remediation workflow.**
  `enforce_retest_request_permissions` requires a caller without
  `has_role('security')` to name a remediation ticket in `fix_submitted` or
  `rejected`, and refuses anyone a ticket raised against a different risk. A
  developer with no eligible ticket can still post a message and ask a question;
  they cannot create a retest run.
- **Legacy message tables are archived, not dropped.** `assessment_messages`,
  `ticket_messages` and `ticket_attachments` keep their rows, but every policy
  on them is dropped, so nothing in the dashboard can read or add to them.
  Destructive removal waits for an agreed retention period and explicit
  approval.
- **Historical ticket messages moved where the mapping is exact.** A ticket
  names an application and its finding names a risk, and together those are the
  conversation, so `place_unlinked_ticket_conversations()` links any remediation
  ticket that has no conversation and migrates its archived messages and their
  attachments. `ticket_messages.migrated_entry_id` and
  `ticket_attachments.migrated_attachment_id` make that idempotent and leave an
  unmigrated record visibly unmigrated. A ticket whose finding names no risk is
  still left unlinked rather than guessed at, and assessment-wide messages name
  no risk, so none were ever moved.
- **The merge is what `0021` ran, and what the tests run.**
  `merge_duplicate_risk_conversations()` folds every conversation sharing an
  `(application_id, risk_id)` into the oldest of the set — `created_at` then
  `id`, so the choice is deterministic — moving entries, retests and ticket
  links first and refusing to delete anything that still holds a reference.
  Both it and `place_unlinked_ticket_conversations()` are kept in the schema
  rather than inlined in the migration, so the RLS suite exercises the
  migration's own logic instead of a copy that can drift from it.

`supabase/tests/0020_risk_conversations_rls.sql` covers the model and its
policies; `supabase/tests/0021_application_risk_conversations_rls.sql` covers
the identity, the merge and the historical placement. Both run against a live
database, own fixtures and all, ending in `rollback`.

## Assessment execution

An assessment is a record; getting it run is a separate, durable request.
`assessment_run_requests` holds one row per attempt to execute an assessment,
and the backend worker in `mobile_playbook/assessment_worker.py` drains it.

- **Configuration readiness and execution readiness are different questions.**
  An app can be fully configured while its device is unplugged, so the
  automation host reports `configuration_ready`, `device_required`,
  `device_ready`, `platform_available` and `runnable` separately, with a
  `blocker_code` and a `retryable` flag. The dashboard branches on those rather
  than reading a message.
- **Execution does not depend on a page being open.** Creating an assessment
  creates a request; the worker starts the run. Refreshing, leaving, or opening
  the assessment in three tabs changes nothing.
- **One active request per assessment**, enforced by a partial unique index over
  `status in ('queued', 'waiting', 'claimed', 'running')`. `request_assessment_run()`
  returns the request already in flight instead of opening a second one, so a
  repeated retry is a no-op rather than a duplicate run.
- **The queue is written only through functions.** There is a select policy and
  no insert, update or delete policy, so neither a developer nor security can
  edit the queue by hand and bypass the state machine.
  `request_assessment_run()` refuses a caller without `has_role('security')`, an
  assessment outside their access, and one that has already completed.
- **Claims are atomic and leased.** `claim_assessment_run_request()` uses
  `for update skip locked`, so two workers polling at the same instant take
  different rows rather than the same one. A claim carries
  `lease_expires_at`; `recover_expired_assessment_run_leases()` returns an
  abandoned request to the queue with `blocker_code = 'lease_expired'`, which is
  how a worker that was killed mid-claim is recovered.
- **A blocked attempt waits rather than failing.** `status = 'waiting'` with a
  `blocker_code` and a `next_attempt_at` set by bounded exponential backoff
  (30s doubling to a 900s ceiling, 20 attempts). The assessment stays visible
  and retryable; no second assessment is created.
- **The request's job ends when the run starts.** It is marked `completed` once
  the automation host accepts the run, so its lease cannot expire mid-test and
  cause a duplicate. The sync worker then moves the assessment to `completed` or
  `failed`.
- **Assessment transitions are enforced.** `enforce_assessment_status_transition`
  permits `queued → waiting → running → completed`, a retryable `failed → queued`,
  and a fresh `completed → queued` cycle, but refuses `completed → running`, so
  stale frontend state cannot restart a finished assessment.
- **Only the platform lock decides who touches the device.** The database claim
  says which worker owns a *request*; the automation host's own per-platform
  lock still decides whether a run may start, and answers `409` when it may not.
  That is treated as a retryable blocker.

`supabase/tests/0023_assessment_run_requests_rls.sql` exercises all of this
against a live database, own fixtures and all, ending in `rollback`.

## Developer remediation progress

`ticket_controls` and `ticket_control_steps` record how far a developer has got
through a finding's remediation. They hold **workflow state only**.

- **No playbook content is stored, and no snapshot of it.** The control's title,
  summary, ordering, step text, code blocks, screenshots and archives all live in
  the automation backend's external playbook directory and are fetched per
  request. A row is `(ticket_id, control_id)` or `(ticket_control_id, step_key)`
  plus a status, a timestamp, who did it and an optional note. `0019` dropped the
  columns `0017` had copied in — `playbook_revision`, `title`, `step_count`,
  `position`, `step_title` and `step_index` — because a ticket that carried them
  went on following the version of the playbook it was opened against.
- **A ticket always renders the current playbook.** The dashboard pairs the
  backend's live controls and steps with these rows by id. Whatever the playbook
  says today is what the developer sees today.
- **`step_key` is the playbook's stable step id.** A playbook author declares it
  above the step; a document that declares none falls back to an id derived from
  the instruction's own text. Either way it survives rewording (declared) or
  reordering (both), which is what lets progress stay attached to the right
  instruction. See
  [the backend's playbook guide](../../playbook/mobile_playbook_automation/docs/developer-playbook.md).
- **Reconciliation only adds.** Opening a ticket inserts a row for any control or
  step the playbook lists that the ticket does not yet have. Nothing is updated
  and nothing is deleted, so a step removed from the playbook keeps its history —
  it simply stops being rendered and stops counting toward completion.
  `unique (ticket_id, control_id)` and `unique (ticket_control_id, step_key)` back
  an `upsert … ignoreDuplicates`, so reconciling repeatedly creates each row at
  most once.
- **Only active, required controls are reconciled.** A `deprioritized` or
  `deprecated` control is never counted as required developer work.
- **Progress cannot be deleted.** Both tables have `select`, `insert` and
  `update` policies and no `delete` policy, and RLS denies whatever a policy does
  not allow. Rows go only when their ticket does, by cascade.
- **Access follows the ticket.** `can_access_ticket_control()` resolves a step
  to its ticket, which resolves to an application, which is team-scoped — so
  team scoping on applications carries through to control progress with no
  separate rule to keep in sync.
- **`completed_by` must be the caller.** Every write policy carries
  `completed_by is null or completed_by = auth.uid()`, so the audit trail cannot
  name someone else.

`supabase/tests/0017_ticket_controls_rls.sql` exercises all of this against a
live database. It builds its own fixtures, impersonates each role, and ends in
`rollback`, so it is safe to run against a real project from the SQL Editor.

## Developer withdrawal

A developer who decides not to continue needs a way out that is not `closed`.
`closed` means security verified the remediation and finalised the ticket, so
`0018_ticket_withdrawal.sql` adds a separate terminal state, `withdrawn`, plus
`withdrawn_at`, `withdrawn_by` and `withdrawal_reason` on `tickets`.

- **Withdrawing is not resolving.** It never sets `closed_at` and never touches
  the finding. The finding stays `at_risk` and keeps appearing as work that
  needs doing; the Resolve dashboard counts a withdrawn ticket as withdrawn and
  as nothing else — not active, not awaiting security, not resolved.
- **Withdrawal stops before security starts.** `withdrawn` is reachable only
  from `open`, `in_progress`, `fix_submitted` or `rejected`. Once the developer
  has asked for a reassessment the request is in security's queue, so cancelling
  it is security's call, and the trigger refuses a developer withdrawal from
  `retest_requested` onwards.
- **A withdrawal must be complete and honest.** The trigger requires a non-empty
  `withdrawal_reason`, requires `withdrawn_at`, and requires `withdrawn_by` to be
  the caller — a developer cannot record someone else as the one who stopped.
- **Withdrawal details are written once.** After the withdrawing update they
  cannot be edited, so the record of why work stopped survives a later resume.
- **Resuming is the only way back, and only to `in_progress`.** A withdrawn
  ticket keeps its risk conversation, evidence, control progress, activity,
  creator, application and finding; resuming changes the status and nothing
  else.
- **Security keeps closure over everything.** Security can still read, work on
  and close a withdrawn ticket, and a developer can never reopen a ticket
  security has closed or accepted.

`supabase/tests/0018_ticket_withdrawal_rls.sql` exercises all of this the same
way `0017`'s does: own fixtures, one role at a time, ending in `rollback`.

## Admin page (Teams, Users, Applications, Roles)

`src/pages/Admin.tsx` (`/admin`, requires the `admin` role specifically —
`security` alone does not grant access) covers what used to require raw
SQL: creating teams, assigning a user's `profiles.team_id` and `roles`,
linking an application's `developer_team_id`, activating/deactivating a
user, and editing application metadata (`applicationData.update`). It
relies on the `teams_write`/`teams_update` and `profiles_update_by_admin`
policies (`0005_admin_policies.sql`, tightened from `security` to `admin`
in `0006_multi_role_admin.sql`) — before `0005`, only a user's own profile
row could be updated (`profiles_update_self`), so there was no way to
change *another* user's team or roles from the app at all.

Note that `applications` writes (used both by the Admin page and by
automation sync) stay open to `security` **or** `admin` — sync needs to
run under a Security Team session, unrelated to who manages the Admin
page.

## New user -> profile

Every new `auth.users` row gets a `profiles` row with the
least-privileged role, `roles = ['developer']`, via the `handle_new_user`
trigger. An admin must explicitly grant `security`/`cio`/`admin`
afterwards, from the Admin page — this trigger never grants elevated
roles itself.

## Storage path conventions

Both buckets are private; the frontend reads files via short-lived signed
URLs (`src/data/services.ts`), never public URLs. The storage RLS policies
in `0003_storage.sql` parse access from the object path, so upload code and
policy must agree on these conventions:

- `ticket-attachments/conversation-<conversation_id>/<filename>` —
  `can_access_attachment_object` (`0020`) reads the `conversation-` prefix and
  checks the risk conversation. A bare `<ticket_id>/<filename>` first segment is
  also accepted, because a ticket attachment migrated into a conversation entry
  keeps the object path it was uploaded to.
- `evidence/finding-<finding_id>/<filename>` or
  `evidence/ticket-<ticket_id>/<filename>` — `can_access_evidence_object`
  reads the `finding-`/`ticket-` prefix to decide which table to check
  against.

## Application icons

`0016_application_icon_refs.sql` adds three nullable columns to `applications`:

| Column | Holds |
| --- | --- |
| `artifact_sha256` | SHA-256 of the build the icon came from |
| `icon_ref` | logical reference of the form `icons/<ARTIFACT_ID>.png` |
| `icon_extraction_status` | `available`, `unavailable` or `failed` |

**No image data lives here.** The automation backend owns the IPA/APK and the
extracted PNG; these columns are a pointer and a status, and the frontend turns
them into a request to the backend
([automation-api.md](./automation-api.md#application-icons)). A `bytea` or base64
column was rejected deliberately: `applicationData.list()` selects `*` and runs
on every assessments page load, so image bytes would ride along on the hot path,
and the dashboard would then hold two copies of something the backend already
stores content-addressed.

`icon_ref` is a logical reference rather than a URL because the backend's origin
is deployment-specific and already configured once as `VITE_API_BASE_URL`.
Storing an absolute URL would pin every row to one host and break on a move.

`artifact_sha256` is the checksum of the build a run actually executed against,
recorded by the run itself, so an icon stays bound to the build that produced the
assessment rather than to whatever was uploaded most recently.

All three are nullable and default to null, which is the correct state for every
row that existed before the migration — the frontend treats null as "no icon" and
renders its placeholder. Check constraints reject anything that is not a hex
digest, not the exact `icons/<64 hex>.png` shape, or not one of the three
statuses, so a malformed reference cannot reach the frontend and be turned into a
request. Access is unchanged: the `applications_select`/`applications_update`
policies in `0002_rls.sql` are row-level, so the new columns inherit them without
a policy change.

The migration is **required** for icon-enabled synchronisation, not optional: the
sync worker writes these fields on every application row, so without it a pass
fails with `column ... does not exist`. A dashboard running against a backend
that never writes icon references works fine with the columns present and null.

## Idempotent sync

See [AUTOMATION_API.md](./automation-api.md#idempotent-sync) for how
`src/data/sync.ts` uses `applications.external_id` and
`findings.external_id` to keep re-syncing the same automation run
duplicate-free.

## Manual assessment creation

The original spec for this dashboard explicitly forbade assessment
creation from the frontend — assessments were meant to exist only as a
byproduct of automation runs. That was deliberately overridden: Security
Team can now add an app directly via "Add App" (`syncService.addApp`,
`src/pages/Assessments.tsx`).

This inserts an `applications` row (`0004_application_contacts.sql` adds
`app_type`/`owner_name`/`owner_email`/`developer_contact_name`/
`developer_contact_email` for this) and a placeholder `assessments` row
with `status = 'queued'` (displayed as "Not Started") and `total_tests` set
from the platform's risk catalogue. It also opens an `app_provisioning`
ticket for Security to track downloading the app onto a device (and
registering it under the test Apple ID, for iOS) — see
[ROLES_AND_WORKFLOWS.md](./roles-and-workflows.md#app-provisioning-workflow).

Crucially, the app is **also registered with the automation backend** in the
same operation, and the backend app id it returns is stored as
`external_id` right away — see
[AUTOMATION_API.md](./automation-api.md#app-provisioning). That's what lets a
later automation run for the same app merge into this row.

Historically it did not: `external_id` was left null, the sync worker matches
applications by `external_id`, and so the first real run created a *second*,
permanently-duplicate `applications` row. Two safety nets remain for rows
created before this changed, or created while the backend was unreachable:
the worker's `find_unlinked_applications` adopts an unlinked row on first sync
(matching name + platform, and refusing to guess when several match), and
`addApp` refuses to create a second app with
a name + platform that already exists. Genuinely duplicated rows from before
those existed still need
[`supabase/scripts/cleanup_duplicate_applications.sql`](../supabase/scripts/cleanup_duplicate_applications.sql).
