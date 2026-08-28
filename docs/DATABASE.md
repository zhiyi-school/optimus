# Database Design Notes

The schema itself lives in `supabase/migrations/` (`0001_schema.sql` /
`0002_rls.sql` / `0003_storage.sql` / `0004_application_contacts.sql` /
`0005_admin_policies.sql` / `0006_multi_role_admin.sql` /
`0007_app_provisioning.sql` / `0008_assessment_messages.sql` /
`0009_application_contact_emails.sql` / `0010_applications_delete.sql` /
`0011_application_provisioning.sql`) —
this doc covers the *why* behind a few decisions that aren't obvious from
reading the SQL alone.

## Row Level Security

Frontend capability checks (`src/auth/permissions.ts`) are UX only. The
policies in `0002_rls.sql` (as amended by `0005`/`0006`) are the actual
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
- **Ticket status-transition legitimacy is enforced in the application
  layer**, not as a SQL state machine. A developer only ever moving a
  ticket to `fix_submitted`/`retest_requested`, never straight to
  `accepted`/`closed`, is encoded in `src/data/services.ts` and
  `src/components/ticket-actions.tsx`. RLS enforces *who* can write to
  *which rows* (role + team scoping) — it does not re-implement the
  workflow.
- **`id` can never change, for anyone, through the app.** The
  `prevent_role_escalation` trigger on `profiles` raises an exception
  unconditionally whenever `auth.role() = 'authenticated'` — i.e. via the
  anon-key client, no matter who's asking.
- **No one can change their own `roles` through the app — not even an
  admin.** Same trigger: changing another user's `roles` requires
  `has_role('admin')`; changing *your own* `roles` is blocked outright,
  full stop, so a single admin session can grant roles to other accounts
  but can never escalate or quietly de-escalate itself. See
  [SUPABASE_SETUP.md](./SUPABASE_SETUP.md#role-assignment) for how you
  bootstrap the first admin (direct SQL — there's no other way in, by
  design).
- **`is_active` is looser**: any `admin` can toggle it for *any* account,
  including their own — suspending/reinstating only gates access a role
  already implies, it can't grant a new privilege the way a `roles` change
  could, so the self-change restriction doesn't apply to it.

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

## Idempotent sync

See [AUTOMATION_API.md](./AUTOMATION_API.md#idempotent-sync) for how
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
[ROLES_AND_WORKFLOWS.md](./ROLES_AND_WORKFLOWS.md#app-provisioning-workflow).

Crucially, the app is **also registered with the automation backend** in the
same operation, and the backend app id it returns is stored as
`external_id` right away — see
[AUTOMATION_API.md](./AUTOMATION_API.md#app-provisioning). That's what lets a
later automation run for the same app merge into this row.

Historically it did not: `external_id` was left null, `syncReport` matches
applications by `external_id`, and so the first real run created a *second*,
permanently-duplicate `applications` row. Two safety nets remain for rows
created before this changed, or created while the backend was unreachable:
`findUnlinkedByNameAndPlatform` adopts an unlinked row on first sync
(matching name + platform), and `addApp` refuses to create a second app with
a name + platform that already exists. Genuinely duplicated rows from before
those existed still need
[`supabase/scripts/cleanup_duplicate_applications.sql`](../supabase/scripts/cleanup_duplicate_applications.sql).
