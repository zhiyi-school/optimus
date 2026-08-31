# Roles, Authentication & Workflows

## Roles & Capabilities

Four roles: `developer`, `security`, `cio`, `admin`. **A user can hold more
than one role at once** — `profiles.roles` is an array, not a single value.
All role-gated UI goes through a single capability model
(`src/auth/permissions.ts`) — components call `can("run_test")`, never
`profile.roles.includes("security")`; a capability is granted if *any* of
a user's roles grants it. Frontend checks are UX only; **Supabase RLS is
the real authorization boundary** (`supabase/migrations/0002_rls.sql`,
`0003_storage.sql`, `0006_multi_role_admin.sql`).

| Capability | developer | security | cio | admin |
|---|---|---|---|---|
| view_dashboard | ✅ | ✅ | ✅ | ✅ |
| view_findings / view_tickets | ✅ | ✅ | ✅ | |
| view_assessments | | ✅ | ✅ | |
| create_ticket / submit_fix / request_retest | ✅ | | | |
| comment_ticket | ✅ | ✅ | | |
| run_test / update_finding / close_ticket / review_risk_acceptance | | ✅ | | |
| view_executive_metrics | | | ✅ | |
| access_admin | | | | ✅ |

`admin` is deliberately separate from `security` — holding `security` does
**not** grant access to the Admin page (`/admin`); a user needs `admin`
specifically (in addition to, or instead of, any other role they hold). A
few UI spots (which dashboard to show, ticket message bubble color) need
to pick one representative role when a user has several — see
`primaryRole()` in `src/auth/permissions.ts` for the precedence order
(`security` > `cio` > `developer` > `admin`); this only affects display,
never authorization.

## Authentication

Supabase Auth (email/password) plus a `profiles` table for
application-specific data (`display_name`, `roles`, `team_id`,
`is_active`). `profiles.id` is the Supabase Auth user id. See
[SUPABASE_SETUP.md](./setup.md#role-assignment) for how initial
roles are assigned, and the [Admin page](./data-model.md#admin-page-teams-users-applications)
for how roles get managed day-to-day.

## Ticket Workflow

```text
Developer opens an At Risk / Inconclusive finding
   → "Work on this Risk" creates a remediation ticket
     (never edits the finding directly)
   → Developer discusses, attaches evidence, submits fix info
   → Developer clicks "Request Retest" → ticket → retest_requested
   → Security Team clicks "Run Retest" → automation API runs the test
     → result synced back → finding status updated → ticket → under_review
   → Security Team closes the ticket
```

## Risk Acceptance Workflow

"Accept Risk" creates a **risk_acceptance** ticket + a `risk_acceptance`
row — it never sets the finding to Reduced Risk directly. The Security
Team reviews and accepts/rejects the *business* record
(`risk_acceptance.decision`); the finding's technical `status` is a
separate field that only changes via an actual retest result or an
explicit Security Team override. A finding can legitimately still read
**At Risk** while an accepted-risk record exists — both stay visible.

## App Provisioning Workflow

```text
Security Team clicks "Add App" on the Assessments page
   → registers the application + a placeholder assessment
   → opens an app_provisioning ticket (no finding yet — none exists)
   → Security downloads the app onto a device (+ registers it under the
     test Apple ID, for iOS)
   → Security closes the ticket
   → app is ready to select in "Run Automated Test"
```

`app_provisioning` is the one ticket type not created from a finding —
`tickets.finding_id` is nullable specifically for it
(`0007_app_provisioning.sql`). It's tracking only: closing the ticket
doesn't unlock anything programmatically, since what's actually runnable
is governed by the automation backend's own app roster
(`GET /config/{platform}/apps`), not this dashboard's DB.
