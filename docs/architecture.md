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
├── data/                 # Supabase client + grouped data services
│   ├── supabase.ts
│   ├── services/         # One module per table group
│   │   ├── assessments.ts
│   │   ├── conversations.ts            # conversations, entries, realtime
│   │   ├── conversation-attachments.ts # attachment rows, bucket, signing
│   │   ├── tickets.ts                  # tickets
│   │   ├── retests.ts                  # reassessment requests (retest_runs)
│   │   └── risk-acceptance.ts          # risk acceptance requests and reviews
│   └── types.ts
├── workflows/            # Browser-side operations spanning both backends
│   ├── app-registration.ts   # addApp: register, create rows, roll back
│   └── automation-run.ts     # runAndWait and active-run/progress lookups
├── auth/
│   ├── auth-context.ts   # Context, value type and useAuth()
│   ├── auth-provider.tsx
│   └── permissions.ts    # Capability model
├── components/
│   ├── ui/                # Small shadcn-style primitives
│   ├── common.tsx         # PageHeader, StatCard, Empty/Error/Loading states...
│   ├── data-display.tsx   # Badges, DataTable
│   ├── evidence.tsx
│   ├── layout.tsx         # App shell and navigation
│   └── ticket-actions/    # Remediation, acceptance, reassessment, composition
├── pages/                 # One file per route (see Routes below)
├── hooks/
│   ├── query-keys.ts      # Exact entity and prefix key factories
│   ├── queries/           # Hooks grouped by assessment, automation, control
│   │                      # progress, conversation, evidence, playbook,
│   │                      # reference, risk acceptance, and ticket
│   ├── attachment-download.ts
│   ├── conversation-composer.ts
│   ├── conversation-submission.ts
│   ├── ensure-remediation.ts
│   ├── remediation-readiness.ts
│   ├── remediation-reconciliation.ts
│   ├── risk-workspace-data.ts
│   └── use-reassessment-run.ts
├── lib/                   # Pure domain helpers and neutral presentation models
├── App.tsx
└── main.tsx

supabase/
├── migrations/            # Fresh-install baseline, applied to new projects only
│   ├── 0001_extensions_and_tables.sql
│   ├── 0002_functions.sql
│   ├── 0003_triggers.sql
│   ├── 0004_rls_policies.sql
│   ├── 0005_grants.sql
│   └── 0006_storage.sql
├── fixes/                 # Numbered corrections not yet in the baseline, applied everywhere
├── legacy-migrations/     # Historical chain that live projects ran
├── tests/                 # SQL suites against the final schema
│   └── legacy/            # Suites pinned to a historical migration version
└── test-support/          # Disposable-runner bootstrap, seeds and assertions
```

`supabase/test-support/` and `scripts/test-database.sh` own the synthetic fresh
installation, legacy-chain, `0024` upgrade and baseline-equivalence contract. See
[Database maintenance](./database-maintenance.md); application modules never
invoke that explicitly disposable workflow.

Query implementations and consumers import domain modules directly. Repeated
invalidation groups live beside their domain hooks in
`hooks/queries/invalidation-rules.ts` and retain narrow prefix-versus-entity
semantics. Ticket action modules own their controls directly, while
`use-reassessment-run.ts` owns the asynchronous run sequence.

Conversation persistence belongs to `data/services/conversations.ts`.
Attachment byte and metadata stages belong to
`data/services/conversation-attachments.ts`; the submission coordinator retains
their partial-success context. The services call the current RPCs and columns
directly; there are no older-schema fallbacks.
Assessment services contain assessment and assessment-run-request operations
only. Shared evidence item shapes live in `lib/evidence-types.ts`, so API and
domain mapping code does not depend on a React component.

The playbook parser remains backend-owned. The frontend keeps only the generated
`src/test-fixtures/playbook-control-v1.json` transport artifact and renders it in
`components/playbook-contract.test.tsx`; this verifies the repository boundary
without copying parser rules or the external playbook into application code.

Remediation availability is calculated once in
`lib/remediation-workflow.ts`. The pure calculator returns reason codes and a
separate module owns their text. `remediation-readiness.ts` owns the queries
that feed it, `remediation-reconciliation.ts` persists the selection and
progress it plans, and `conversation-submission.ts` owns the record-then-attach
state machine.

Both roles' feature-risk workspaces, `TestDetail` and `ResolveRisk`, load the
application-keyed conversation, run history, evidence rail and plaintext
analysis through `risk-workspace-data.ts`. Each page keeps its own run,
ticket and reassessment behavior.

## Maintenance and extension points

| Change | Owner and required verification |
| --- | --- |
| Automation API field, enum or request | `src/api/automation-types.ts` and `automation-services.ts`; extend `automation-services.test.ts` and coordinate the backend contract tests |
| Supabase read/write | One domain module under `src/data/services/`; correct older schemas with a new fix, not client fallbacks, and add service tests |
| Query behavior | The matching `src/hooks/queries/` module; query keys belong to `query-keys.ts`, narrow invalidation groups to `queries/invalidation-rules.ts` |
| Workflow/submission behavior | Pure rules under `src/lib/`, coordination under focused hooks, database enforcement in a new fix and SQL test |
| Database fix | Next numbered `supabase/fixes/` file plus fresh, legacy-chain, `0024` upgrade, equivalence, final-schema and RLS coverage through `npm run test:database` |
| Playbook rendering | Backend parser fixture plus `src/test-fixtures/playbook-control-v1.json` and `playbook-contract.test.tsx`; do not copy parser rules into the frontend |
| Regression fixture | Prefer a small local factory with fresh objects; add to `src/test-fixtures/` or `src/test-support/` only for a shared stable domain contract |

Pages depend on hooks and presentation helpers; hooks depend on query keys and
domain services; Supabase services and API adapters do not import React
components. The browser loads only `VITE_` configuration and the anon key. The
backend sync and assessment workers own service-role credentials and remain
outside this repository.

## Routes

```text
/                                                       Dashboard
/assessments                                            Assessments
/assessments/new                                         New assessment (Security Team)
/assessments/:assessmentId                               Assessment details + tests
/assessments/:assessmentId/tests/:testId                 Test workspace + run history
/assessments/:assessmentId/tests/:testId/runs/:runId     One run's detail, scoped to a single test
/runs/:runTimestamp                                      One backend run's progress + full result summary
/resolve                                                 Developer workspace: applications in the team's scope
/resolve/applications/:applicationId                     One application's remediation progress
/resolve/findings/:findingId/controls/:controlId         One control, read-only, before any ticket exists
/resolve/applications/:applicationId/risks/:riskId       One feature-risk: conversation, evidence, remediation
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

A remediation has no page of its own. `RemediationSection`
(`src/components/remediation-section.tsx`) is a section of the
feature-risk workspace, beneath the risk header and beside its conversation, so
a developer never leaves the thread to work through the controls.
Links into it are built by `resolveRiskPath` (`src/lib/risk-routes.ts`), which
degrades to the application, then to `/resolve`, when a ticket names no risk or
no application. Closing, cancelling or finishing the guided
steps returns to the same place.

The two current control routes under `/resolve` render one component pair —
`ControlDetail` for a ticket and `ControlPreview` for a finding — over a shared
`control-steps-view` frame and `control-content` module, so the step
navigation, Markdown blocks, screenshots, references and the archive are
rendered in one place. Both use `ResolveGuard`; whether steps can be
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

## Spelling and compatibility identifiers

Human-facing prose uses the spelling “artifact”. Existing wire, database and
configuration identifiers retain `artifact` where it is part of a compatibility
contract, such as the provisioning request field, `/artifacts` route and
`artifact_sha256` column. Those names change only through a coordinated,
versioned frontend/backend or database migration.
