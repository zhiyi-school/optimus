# Frontend Integration

How to reuse this dashboard in another project, and — critically — what a
replacement backend has to implement before pointing `VITE_API_BASE_URL` at it.

All examples use placeholders: `Example App`, `example-app`,
`com.example.placeholder`, `<RUN_ID>`, `<RUN_TIMESTAMP>`, `<APP_ID>`,
`<RISK_ID>`, `<PLATFORM>`, `https://dashboard.example.com`.

> This is not plug-and-play. Every path below still requires a Supabase project
> with migrations applied, authentication configured, and — for automation
> features — a backend with a physical test device attached. Assumptions are
> listed under [What you still have to do yourself](#what-you-still-have-to-do-yourself).

## Four reuse shapes

**1. The complete dashboard as-is.** Point it at your Supabase project and your
automation backend. Least work, most assumptions inherited.

**2. Selected pages or components.** Lift `src/components/` and the hooks they
need. The genuinely portable parts are listed under
[Reusable vs project-specific](#reusable-vs-project-specific).

**3. Against a replacement API server.** Change `VITE_API_BASE_URL` — but only
after implementing the [compatibility contract](#required-backend-compatibility-contract).
Matching endpoint *names* is not sufficient.

**4. Against an existing Supabase project.** Apply this repo's migrations into
it. The dashboard depends on specific tables, columns, an RPC and RLS policies;
see [data-model.md](./data-model.md).

## Requirements

| | Requirement |
| --- | --- |
| Node.js | 20+ with npm (Vite 7) |
| Build | `npm install`, then `npm run build` (runs `tsc -b` then `vite build`) |
| Output | static files in `dist/`, servable by any static host |
| Supabase | project with `supabase/migrations/*.sql` applied |
| Backend | only for automation features |

```bash
npm install
npm run dev         # dev server on :5173
npm test            # vitest
npm run typecheck   # tsc -b
npm run lint        # eslint
npm run build       # typecheck + production build
npm run preview     # serve dist/ locally
```

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | for automation features | base URL of the automation API, e.g. `http://localhost:8080` |
| `VITE_SUPABASE_URL` | yes | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | yes | Supabase **anon** key |
| `VITE_APP_NAME` | no | display name in the UI shell |

Every `VITE_` variable is compiled into the bundle and is **public**. The anon
key is designed for that and is constrained by row-level security. A
`service_role` key must never appear here, in a `VITE_` variable, in a
committed file, or anywhere a browser can reach — it belongs solely to the
automation host's sync worker.

Variables are read at build time. A change needs a dev-server restart or a
rebuild; a Docker image must be rebuilt with new `--build-arg` values.

## Authentication assumptions

Authentication is Supabase Auth with email/password. The dashboard assumes:

- a `profiles` row exists per auth user, created by the `handle_new_user`
  trigger in `0001_schema.sql`;
- roles live in `profiles.roles` (a text array) — `developer`, `security`,
  `admin`, `cio`;
- capabilities are derived from roles in `src/auth/`, and RLS enforces the same
  rules independently in the database;
- the first `admin` is bootstrapped with one SQL statement; after that admins
  manage roles from `/admin`.

There is no SSO, no MFA and no session management beyond Supabase's own. See
[roles-and-workflows.md](./roles-and-workflows.md).

## Required Supabase objects

Applying `supabase/migrations/*.sql` in order gives you everything. If you are
merging into an existing project, these are the dependencies:

| Kind | Objects |
| --- | --- |
| Tables | `profiles`, `teams`, `applications`, `assessments`, `assessment_messages`, `findings`, `finding_history`, `evidence`, `tickets`, `ticket_messages`, `ticket_attachments`, `retest_runs`, `risk_acceptance`, `activity_log` |
| Team scoping | a `team_id` column on `profiles`, `developer_team_id` on `applications`, `assigned_team_id` on `tickets` — there is no join table |
| Contacts | columns on `applications` (`owner_email`, `developer_contact_*`, `contact_emails[]`), added by `0004` and `0009` — not a separate table |
| RPC | `dashboard_metrics()` — the overview page's fast path; the UI falls back to per-table queries and logs a console warning naming `0012_dashboard_metrics_rpc.sql` if it is absent |
| Storage | `ticket-attachments` and `evidence` buckets, both private (`0003_storage.sql`) |
| RLS | policies from `0002_rls.sql`, extended by `0005`, `0006`, `0010`, `0011` |
| Idempotency | `sync_key` columns and their partial unique indexes (`0013_sync_idempotency_keys.sql`) — **the sync worker fails without these** |
| Grants | `0014_dashboard_metrics_grants.sql`, then `0015_dashboard_metrics_revoke_anon.sql` |
| Icon refs | `artifact_sha256`, `icon_ref`, `icon_extraction_status` on `applications` (`0016_application_icon_refs.sql`) — **required if the backend syncs icon references**, since the worker writes these fields on every application row |

Migrations are additive and must be applied in numeric order. Table
relationships and the RLS rationale: [data-model.md](./data-model.md).

## Required backend compatibility contract

Changing `VITE_API_BASE_URL` to a replacement server works **only** if that
server reproduces the contract below. **Implementing endpoints with the same
names is not sufficient** — the dashboard depends on exact response shapes,
status codes, identifier semantics and error behaviour. A server that returns
`200` with a different body, or a different value in `status`, will fail in ways
that look like dashboard bugs.

The dashboard's expectations are encoded in `src/api/automation-types.ts` and
`src/api/automation-services.ts`; treat those as the specification.

### Values that must match exactly

| Concept | Required values |
| --- | --- |
| `platform` | `"ios"` or `"android"` |
| run `status` | `"running"`, `"completed"`, `"failed"` |
| sync `status` | `"queued"`, `"running"`, `"completed"`, `"failed"`, `"not_required"` |
| SARIF `result.kind` | `"pass"`, `"fail"`, `"review"`, `"open"`, `"notApplicable"`, `"informational"` |
| provisioning `status` | `"pending"`, `"ready"`, `"failed"` |
| provisioning stage `state` | `"pending"`, `"in_progress"`, `"done"`, `"failed"`, `"unknown"` |
| `icon_extraction_status` | `"available"`, `"unavailable"`, `"failed"` |
| `icon_ref` | exactly `icons/<64 lowercase hex>.png`, or `null` |
| verdict | `"At Risk"`, `"Reduced Risk"`, `"Inconclusive"` |

### Identifier semantics

- **`run_id` and `run_timestamp` are the same value**, and it is the report
  directory name. The dashboard uses `run_id` for `/runs/...` and the identical
  string for `/reports/...`. A server with two separate ID schemes breaks
  navigation between live status and stored reports.
- **Run IDs must be stable and collision-free.** The dashboard treats them as
  durable keys, including across restarts.
- `apps` and `risks` on a run record echo the selection the run was started
  with, `null` meaning "everything". The dashboard uses them to re-find an
  in-flight run after a page reload; without them it cannot tell which test a
  run belongs to and will show the wrong page as running.

### Endpoint contract

| Endpoint | Method | Request | Response | Codes |
| --- | --- | --- | --- | --- |
| `/health` | GET | — | `{"status":"ok"}` | 200 |
| `/platforms/{platform}/risks` | GET | — | array of risk definitions with `risk_id`, `name`, `description`, `goal`, `automation_available`, `demonstration` | 200 |
| `/platforms/{platform}/features` | GET | — | array of `{feature_id, name, description}` | 200 |
| `/config/{platform}/apps` | GET | — | array of `{id, name, bundle_id?, package_name?}` | 200 |
| `/config/{platform}/apps` | POST | `{name, version?, bundle_id?, package_name?, artifact?, risks?}` | `{id}` | 201, 409 with `{detail:{app_id}}` on duplicate |
| `/config/{platform}/apps/{app_id}/provisioning` | GET | — | `{app_id, platform, bundle_id, status, stages[], error}` | 200, 404 |
| `/config/{platform}/apps/{app_id}/icon` | GET | — | `image/png`; `ETag`/`Cache-Control` optional | 200, 404 for unknown app **and** for no icon |
| `/runs` | GET | — | array of run records | 200 |
| `/runs` | POST | `{platform, config_path, apps?, risks?, out_dir?}` | `{run_id, platform, status}` | **202**, 409 busy, 422 unknown app/risk |
| `/runs/{run_id}` | GET | — | full run record | 200, 404 |
| `/runs/{run_id}/events` | GET | — | SSE, see below | 200, 404 |
| `/runs/{run_id}/summary` | GET | — | array of result rows | 200, **409 while running**, **500 with the error if failed** |
| `/runs/{run_id}/sync-status` | GET | — | sync status object | 200, 404 |
| `/sync/status` | GET | — | worker status object | 200 |
| `/runs/{run_id}/sync` | POST | — | sync status object | 202, 409, 503 |
| `/reports` | GET | — | array of run timestamps, newest first | 200 |
| `/reports/{run_timestamp}/summary` | GET | — | array of result rows | 200, 404 |
| `/reports/{run_timestamp}/files/{file_path}` | GET | — | the raw file | 200, 404 |
| `/reports/{run_timestamp}/evidence-file?path=` | GET | — | the raw file | 200, 404 |
| `/reports/{run_timestamp}/sarif` | GET | — | SARIF 2.1.0 document | 200, 404 |
| `/apps/{app_id}/risks/{risk_id}/history` | GET | `limit` query, 1–100 | array of result rows, newest first | 200 |

**Result row shape** (`dashboard_results.json`), returned by both summary
endpoints and by history:

```json
{
  "app_id": "example-app",
  "app_name": "Example App",
  "platform": "<PLATFORM>",
  "package_or_bundle_id": "com.example.placeholder",
  "test_id": "<RISK_ID>",
  "test_name": "Example Risk",
  "category": "example_category",
  "status": "EXAMPLE_STATUS",
  "verdict": "Inconclusive",
  "severity": "medium",
  "summary": "One-line human-readable outcome.",
  "evidence": [{"kind": "screenshot", "label": "Example", "path": "<EVIDENCE_PATH>"}],
  "started_at": "<TIMESTAMP>",
  "completed_at": "<TIMESTAMP>",
  "duration_seconds": 0,
  "report_path": "<REPORT_PATH>",
  "run_timestamp": "<RUN_TIMESTAMP>",
  "raw": {}
}
```

**SSE format.** `text/event-stream`, one JSON object per `data:` line. Event
types the dashboard renders: `risk_started`, `risk_completed`,
`appium_recovery`, `device_unlocked`, and a terminal `done` carrying
`{status, error}`, after which the server closes the stream. The stream must
**replay from the beginning on every connection** — a client that connects late
rebuilds the whole timeline from it, and the dashboard relies on that when a
user returns to a page mid-run.

**Sync-status semantics.** `completed` must mean every dashboard write for that
run succeeded, not that the run finished. The dashboard refreshes its
Supabase-backed views on the transition into `completed`; a server that reports
`completed` early will show stale data. `retryable` gates whether a retry button
appears at all.

**Evidence URL behaviour.** Both file endpoints must serve bytes with a
sensible content type, and must reject paths that escape their roots. The
dashboard builds URLs with `assessmentApi.evidenceFileUrl` and
`reportFileUrl`; it does not proxy or rewrite them.

**Error behaviour.** Errors should carry `{"detail": ...}` — a string, or an
object whose `app_id` the provisioning flow reads on `409`. The client wraps
non-2xx responses in an `AutomationApiError` with `status` and `detail`;
`isBackendUnavailable` treats a missing status, `404`, `405` and `501` as "this
backend does not support the feature" and degrades instead of erroring.

### Compatibility table

| Capability | Endpoints required | Consequence if absent |
| --- | --- | --- |
| **Basic run viewing** | `/health`, `/runs`, `/runs/{run_id}`, `/reports`, `/reports/{run_timestamp}/summary` | run pages and history are empty |
| **Starting runs** | `POST /runs`, `/platforms/{platform}/risks`, `/config/{platform}/apps` | no automation can be triggered |
| **Application provisioning** | `POST /config/{platform}/apps`, `/config/{platform}/apps/{app_id}/provisioning`, `POST /artifacts/{platform}` | app onboarding is blocked; provisioning polls return null and the UI falls back to ticket state |
| **Report / evidence viewing** | `/reports/{run_timestamp}/files/{file_path}`, `/reports/{run_timestamp}/evidence-file` | evidence viewers show broken links |
| **Supabase dashboard synchronisation** | the worker plus `/runs/{run_id}/sync-status` | sync notices never appear; findings depend entirely on whatever writes Supabase |
| **Optional: live progress** | `/runs/{run_id}/events` | polling still reports completion, without a timeline |
| **Optional: SARIF export** | `/reports/{run_timestamp}/sarif` | the download button is hidden |
| **Optional: worker operations** | `/sync/status` | worker health is unavailable |
| **Optional: retry** | `POST /runs/{run_id}/sync` | the retry button never appears |

## How the client is structured

| Layer | Location | Role |
| --- | --- | --- |
| HTTP client | `src/api/automation-client.ts` | axios instance, 30s timeout, error interceptor producing `AutomationApiError` |
| Typed services | `src/api/automation-services.ts` | `testApi`, `configApi`, `provisioningApi`, `assessmentApi`, `syncApi`, `healthApi`, plus URL helpers |
| Types | `src/api/automation-types.ts` | the response shapes above |
| Query hooks | `src/hooks/queries.ts` | TanStack Query wrappers, polling intervals, cache invalidation |
| Supabase services | `src/data/services.ts` | all dashboard reads and writes |
| Pure logic | `src/data/sync/runs.ts`, `src/lib/` | run matching, sync presentation, SARIF gating — unit-tested |

Polling intervals and timeouts: [configuration.md](./configuration.md).

## Deployment and reverse proxy

The build is static files in `dist/`. Serve them from any static host; the
bundled Docker image uses nginx with SPA fallback to `index.html`.

Two hosts must be reachable **from the browser**, not from the server:
Supabase, and the automation API at `VITE_API_BASE_URL`. If the backend sits
behind a reverse proxy, `VITE_API_BASE_URL` must be the proxy's public URL, and
the backend's `CORS_ALLOWED_ORIGINS` must list the dashboard's exact origin.
Proxying SSE requires buffering disabled (`proxy_buffering off;` in nginx),
otherwise live progress arrives only when the run ends.

The automation API has no authentication of its own. Anything beyond localhost
or a trusted LAN needs an authenticating proxy or VPN in front of it. See
[deployment.md](./deployment.md).

## Reusable vs project-specific

**Reusable with little change:**

- the API client pattern — client, typed services, error normalisation
- run polling and SSE handling, including reconnection and timeline replay
- report and evidence URL helpers
- the normalised run/result types
- sync-status UI behaviour — polling that stops on terminal states, refreshing
  dependent views on completion, retry gating
- the SARIF export contract

**Project-specific, expect to replace:**

- mobile-device setup and Appium capabilities
- YAML risk configuration and the risk catalogue
- the Supabase schema and RLS policies
- the role model (`developer` / `security` / `admin` / `cio`)
- the ticket, retest and risk-acceptance workflow
- evidence storage layout
- authentication
- deployment environment

## What you still have to do yourself

- create and migrate a Supabase project, and bootstrap the first admin in SQL
- configure authentication and, for production, SMTP
- attach and prepare a physical test device, install Appium and its drivers
- write per-app YAML configuration in the backend
- set exact CORS origins on the backend
- put an authenticating proxy in front of the automation API for any
  non-local deployment

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| CORS error in the console | the dashboard's origin is not in the backend's `CORS_ALLOWED_ORIGINS` | add the exact origin — scheme, host and port; `*` is rejected |
| Every automation call fails, Supabase works | `VITE_API_BASE_URL` wrong, or the backend is down | `curl $VITE_API_BASE_URL/health` |
| Blank page, console complains about Supabase | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` missing | they are build-time; restart the dev server or rebuild |
| Queries return empty for a signed-in user | migrations not applied, or RLS excludes them | apply `supabase/migrations/*.sql` in order; check `profiles.roles` and team membership |
| Console warns about `0012_dashboard_metrics_rpc.sql` | the metrics RPC is missing | apply that migration; the UI is using the slow fallback |
| Sync worker fails with `column ... does not exist` | `0013_sync_idempotency_keys.sql` not applied | apply it |
| Automation features hidden or inert | the backend is unreachable and the client degraded | expected behaviour; check `/health` |
| Timeline never populates but runs complete | SSE blocked or buffered by a proxy | disable proxy buffering; polling still reports completion |
| Dashboard shows old results after a run | the sync is still `queued`/`running` | eventual consistency — watch the sync notice |
| "Dashboard sync failed" | a Supabase write failed | read the message; retry if `retryable` |
| Nothing ever syncs | the worker is not running, or `DASHBOARD_SYNC_AUTO_TRIGGER=false` | check `GET /sync/status` |
| Report or evidence links 404 | the file is gone, or outside the backend's allowed roots | confirm the run directory still exists on the automation host |
| Every application shows a placeholder icon | `0016` not applied, or no icon reference has been written yet | apply the migration, then run `python -m mobile_playbook.icon_backfill` on the automation host |
| One application keeps its placeholder after a backfill | its build has no icon the backend can read | expected; the backfill records it as `unavailable`. iOS asset-catalog-only and Android adaptive-XML icons are known gaps |
| A replacement API "works" but pages misbehave | shapes, status codes or `run_id` semantics differ | re-check the [contract](#required-backend-compatibility-contract) — names alone are not enough |

## Current limitations and follow-up work

- **No versioned contract.** The compatibility table above is prose. There is
  no OpenAPI or JSON Schema file to validate a replacement server against, and
  no version negotiation between dashboard and backend.
- **The automation API has no authentication**, so the dashboard cannot pass
  user identity to it; backend actions are not attributable per user.
- **Eventual consistency** between a completed run and dashboard data, with
  polling as the only signal.
- **Build-time configuration.** Changing any `VITE_` variable requires a
  rebuild, so one artifact cannot serve multiple environments.
- **Single automation host** assumed; the dashboard has no concept of several
  backends or of routing a run to a particular one.
- **Application icons are unauthenticated like the rest of the automation API.**
  The icon endpoint sits behind the same trusted-local/trusted-LAN boundary as
  every other backend route. If the API later gains authentication, the icon
  endpoint must be placed inside the same authorization boundary as the
  application and assessment data it depicts — an app's icon should not be
  readable by a caller who cannot read the app.
