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
`0019_live_playbook_progress.sql`) —
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
- **Assessment messages follow the same access shape as ticket messages.**
  `0008_assessment_messages.sql` adds `can_access_assessment()`, selects by
  application visibility, and inserts only when the author is the caller
  and has `developer` or `security`.
- **Dashboard metrics are still RLS-scoped.** `dashboard_metrics()` in
  `0012` is granted only to authenticated users and queries the base tables
  without `SECURITY DEFINER`, so each count is limited by the caller's
  existing RLS visibility.

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
  ticket keeps its conversation, evidence, control progress, activity, creator,
  application and finding; resuming changes the status and nothing else.
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

- `ticket-attachments/<ticket_id>/<filename>` — `can_access_ticket_object`
  reads the first path segment directly as the ticket's UUID.
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
