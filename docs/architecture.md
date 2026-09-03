# Architecture

## Overview

This dashboard is a client of two independent systems:

- **The automation backend** (`mobile_playbook_automation`) — unchanged,
  and remains the source of truth for iOS/Android test execution, job
  status, raw results, and raw automation evidence.
- **Supabase** — the dashboard's own database: users, roles, teams,
  applications, assessment *metadata*, findings, tickets, messages,
  evidence metadata, and audit history.

```text
┌──────────────────────────────────┐
│        Dashboard Frontend        │
│  React + TypeScript + Vite       │
│  Role-aware UI (capability model)│
└──────────────┬───────────────────┘
               │
       ┌───────┴──────────┐
       │                  │
       ▼                  ▼
┌─────────────────┐  ┌────────────────────────┐
│    Supabase     │  │ Existing Automation API│
│ PostgreSQL       │  │ (mobile_playbook_       │
│ Auth             │  │  automation, FastAPI)   │
│ Users / Roles    │  │ iOS / Android tests     │
│ Findings         │  │ Test execution & status │
│ Tickets/Messages │  │ Raw results & evidence  │
└─────────────────┘  └────────────────────────┘
```

Supabase and the automation API are independent systems, and the dashboard is
the only thing in the browser that talks to both.

## Ownership

```text
Backend automation   owns execution, raw reports, evidence, run status, SARIF
Sync worker          translates completed reports into Supabase
Supabase             owns users, roles, teams, applications, assessments,
                     findings, finding history, tickets, retests, messages,
                     activity
Frontend             reads backend automation state and Supabase dashboard
                     state; performs no authoritative synchronisation
```

**The dashboard is not the synchroniser.** Automation results reach Supabase
through a worker process that runs on the automation host and holds the
service-role key. The browser starts runs, watches progress, and reads what the
worker has already published — it never writes a report feed to Supabase. This
is a security boundary as much as an architectural one: the service-role key
bypasses row-level security, so it must never be reachable from a browser.

### Two statuses

| | Automation status | Dashboard sync status |
| --- | --- | --- |
| Source | `GET /runs/{run_id}` | `GET /runs/{run_id}/sync-status` |
| `completed` means | the device finished executing and the report is on disk | every Supabase write for that report succeeded |

A run is routinely `completed` while its sync is still `queued`. The dashboard
is eventually consistent by design and shows that state explicitly rather than
hiding it — see [automation-api.md](./automation-api.md#dashboard-sync-status).

### End-to-end topology

```text
Browser
  ├── Frontend dashboard (static build)
  ├── Supabase — browser-safe anon credentials, constrained by RLS
  └── Backend automation API — VITE_API_BASE_URL
          └── Mobile devices, Appium, reports on disk, and the sync worker
                  └── Supabase — service-role credentials, worker-only
```

Both Supabase and the automation API must be reachable **from the browser**,
not merely from whatever server hosts the static files.

## Technology Stack

React 18, TypeScript, Vite, Tailwind CSS, a small set of Radix-based
shadcn-style primitives (`src/components/ui`), lucide-react icons, React
Router, TanStack Query, `@supabase/supabase-js`, and Axios for the
automation API client.

## Data Ownership

```text
Supabase Auth User
       │
       ▼
    Profile ──► Team

Application
    │
    ├── Assessments (metadata only)
    │
    └── Findings
           │
           ├── Finding History
           ├── Evidence
           └── Tickets
                  │
                  ├── Messages
                  ├── Attachments
                  ├── Retest Runs
                  └── Risk Acceptance

activity_log — generic audit trail (entity_type, entity_id, action, metadata)
```

| Data | Owner |
|---|---|
| iOS/Android automated tests, test execution, job status, raw results, raw automation evidence | **Automation backend** (`mobile_playbook_automation`) |
| Users, roles, teams, applications, assessment *metadata*, findings, finding history, tickets, messages, attachments, risk acceptance, retest workflow, activity history | **Supabase** |

The dashboard never creates automated tests or job runs by itself outside of
calling the automation backend's own `/runs` endpoint, and it never writes a
report feed into Supabase. The sync worker on the automation host mirrors
completed results so they can be linked to findings and tickets. What the
browser does own is workflow state a person creates — an assessment placeholder,
a ticket, a message, a risk acceptance — written directly to Supabase under
row-level security.

## Project Structure

```text
src/
├── api/                  # Automation backend client (never call fetch() from a page)
│   ├── automation-client.ts
│   ├── automation-services.ts
│   └── automation-types.ts
├── data/                 # Supabase client + grouped data services + sync
│   ├── supabase.ts
│   ├── services.ts
│   ├── sync.ts
│   └── types.ts
├── auth/
│   ├── AuthProvider.tsx
│   └── permissions.ts    # Capability model
├── components/
│   ├── ui/                # Small shadcn-style primitives
│   ├── common.tsx         # PageHeader, StatCard, Empty/Error/Loading states...
│   ├── data-display.tsx   # Badges, ProgressBar, DataTable
│   ├── evidence.tsx
│   ├── timeline.tsx
│   ├── ticket-actions.tsx # Work on Risk / Accept Risk / ticket workflow actions
│   └── Layout.tsx
├── pages/                 # One file per route (see Routes below)
├── hooks/queries.ts        # All TanStack Query hooks
├── lib/                   # utils.ts, status.ts (centralised status/severity config)
├── App.tsx
└── main.tsx

supabase/migrations/
├── 0001_schema.sql
├── 0002_rls.sql
├── 0003_storage.sql
├── 0004_application_contacts.sql
├── 0005_admin_policies.sql
├── 0006_multi_role_admin.sql
├── 0007_app_provisioning.sql
├── 0008_assessment_messages.sql
├── 0009_application_contact_emails.sql
├── 0010_applications_delete.sql
├── 0011_application_provisioning.sql
├── ...
├── 0020_risk_conversations.sql
├── 0021_application_risk_conversations.sql
├── 0022_selected_remediation_control.sql
└── 0023_assessment_run_requests.sql
```

## Routes

```text
/                                                       Dashboard
/assessments                                            Assessments
/assessments/new                                         New assessment (Security Team)
/assessments/:assessmentId                               Assessment details + tests
/assessments/:assessmentId/tests/:testId                 Test workspace + run history
/assessments/:assessmentId/tests/:testId/runs/:runId     One run's detail, scoped to a single test
/runs/:runTimestamp                                      One backend run's progress + full result summary
/findings                                                Findings
/findings/:findingId                                     Finding detail + the risk's developer controls
/findings/:findingId/controls/:controlId                 One control, read-only, before any ticket exists
/tickets                                                 Tickets
/tickets/:ticketId                                       Ticket detail
/tickets/:ticketId/controls/:controlId                   One control, from a ticket, for anyone who may view it
/resolve                                                 Developer workspace: applications in the team's scope
/resolve/applications/:applicationId                     One application's remediation progress
/resolve/findings/:findingId/controls/:controlId         One control, read-only, before any ticket exists
/resolve/tickets/:ticketId                               One finding's remediation workspace
/resolve/tickets/:ticketId/controls/:controlId           One control's ordered steps, writable
/settings                                                Profile + automation defaults
/admin                                                   Teams, users, roles, applications (admin role only)
```

The `/resolve` tree is the developer surface and every route in it is wrapped
in `ResolveGuard`, which resolves `resolveAccess(profile)` to one of
`loading`, `unauthorized`, `inactive`, `no_team` or `ready`. `no_team` is a
setup state, never a grant: an unassigned developer sees an explanation rather
than a fallback list of every application. RLS refuses the same thing
independently, so the guard is UX, not authorization.

`/tickets/:ticketId` and `/resolve/tickets/:ticketId` show the same ticket from
two sides. The Tickets route is the shared, security-oriented view of every
ticket type; the Resolve route is a developer's remediation workspace for one
finding, leading with the required controls and the actions the developer owns.
Both read the same rows.

The three control routes render one component pair — `ControlDetail` for a
ticket, `ControlPreview` for a finding — over a shared `control-content`
module, so a control's Markdown blocks, screenshots, references and archive are
rendered in exactly one place. What differs between them is the capability
gate: `/findings/...` is guarded by `view_findings`, `/tickets/...` by
`view_tickets`, `/resolve/...` by `ResolveGuard`, and whether steps can be
ticked is decided separately by `update_control_progress`. A preview reads no
progress rows and creates none.

`/assessments/new` (Security Team only) registers the app with **both**
systems: an `applications` row plus a placeholder ("Not Started")
`assessments` row and an `app_provisioning` ticket in Supabase, and an entry
in the automation backend's `configs/<platform>.yaml` so runs can actually
target it. See
[AUTOMATION_API.md](./automation-api.md#app-provisioning) for that exchange
and [DATABASE.md](./data-model.md#manual-assessment-creation) for how it
interacts with automation sync.

On submit it navigates to the new assessment's own page rather than back to
the list, because **assessment creation is the only point in the flow with a
real wait**: the app has to be provisioned before anything can run against
it. `AssessmentDetail` polls
`GET /config/{platform}/apps/{app_id}/provisioning` while that's pending and
renders the backend's own stage list, falling back to the
`app_provisioning` ticket's state when the backend isn't tracking the app.

By the time a user is inside a specific test, setup is already done, so
"Run automated test" on `/assessments/:id/tests/:testId` starts executing
immediately — it shows only execution/reporting progress
(`TestRunStages`), never the environment-setup stages
(`EnvironmentSetupStages`). Both live in
`src/components/assessment-progress.tsx`.

The two run-detail routes answer different questions. A backend run can
cover many apps and risks at once (e.g. "run every configured iOS app"),
so `/runs/:runTimestamp` is the *whole run's* view — status, progress, and
one summary row per (app, risk) tested, sourced straight from the backend
via `useRunStatus`, `useRunEvents`, and `useRunResults` regardless of whether
anything has synced into Supabase yet. `/assessments/:id/tests/:testId(/runs/:runId)` is scoped the
other way — one risk's whole story on one application, which is why it fans out
across `GET /reports` (see [AUTOMATION_API.md](./automation-api.md)) instead of
reading a single run. Those runs are merged with the risk's stored conversation
entries into one timeline, so every assessment of the application contributes to
the same page; `:runId` highlights one of them.
