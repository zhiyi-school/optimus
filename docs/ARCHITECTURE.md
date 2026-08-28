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

Supabase and the automation API are independent systems. The dashboard is
the only thing that talks to both — see `src/data/sync.ts`.

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

The dashboard never creates automated tests, assessments, or job runs by
itself outside of calling the automation backend's own `/runs` endpoint —
Supabase only mirrors the resulting metadata so it can be linked to
findings and tickets (`src/data/sync.ts`).

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
└── 0011_application_provisioning.sql
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
/findings/:findingId                                     Finding detail
/tickets                                                 Tickets
/tickets/:ticketId                                       Ticket detail
/settings                                                Profile + automation defaults
/admin                                                   Teams, users, roles, applications (admin role only)
```

`/assessments/new` (Security Team only) registers the app with **both**
systems: an `applications` row plus a placeholder ("Not Started")
`assessments` row and an `app_provisioning` ticket in Supabase, and an entry
in the automation backend's `configs/<platform>.yaml` so runs can actually
target it. See
[AUTOMATION_API.md](./AUTOMATION_API.md#app-provisioning) for that exchange
and [DATABASE.md](./DATABASE.md#manual-assessment-creation) for how it
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
via `useRunResults` regardless of whether anything has synced into
Supabase yet. `/assessments/:id/tests/:testId(/runs/:runId)` is scoped the
other way — one specific test's conversation-style history across *every*
run it's ever appeared in, which is why it fans out across
`GET /reports` (see [AUTOMATION_API.md](./AUTOMATION_API.md)) instead of
reading a single run.
