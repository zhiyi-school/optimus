# Automation API Integration

The dashboard talks to the automation backend's existing FastAPI endpoints
(`mobile_playbook/api/app.py`, documented in that project's `docs/api.md`):
`GET /platforms/{platform}/risks` (test catalogue), `GET /config/{platform}/apps`
(configured app roster, used to populate the app multi-select when starting a
run), `POST /runs` / `GET /runs/{id}` (start/poll a run), `GET /reports` /
`GET /reports/{run_timestamp}/summary` (results), and
`GET /reports/{run_timestamp}/files/{path}` (evidence files). No changes
were made to that backend.

## Starting a run

Wherever the dashboard starts a run (Assessments page, Test Workspace, ticket
retest), the platform is a single-select (`ios`/`android`) and the config
path is never user-entered — it's always the backend's standard
`configs/<platform>.yaml` (`src/api/automation-services.ts#defaultConfigPath`).
Apps and risks are multi-selects: apps come from `GET /config/{platform}/apps`
(the `id` field — matched by the backend against an app's `id`, `name`,
`package_name`, or `bundle_id`), risks come from `GET /platforms/{platform}/risks`
(the `risk_id` field, matched verbatim). Both are sent as comma-separated
strings on `POST /runs`, and leaving a multi-select empty means "all" (the
backend runs every configured app / every risk for that platform).

## App provisioning

Adding an app from `/assessments/new` registers it with the automation
backend, not just in Supabase — this is what makes it testable at all, since
`POST /runs` resolves app ids out of `configs/<platform>.yaml`.
`syncService.addApp` calls `POST /config/{platform}/apps`, stores the returned
`id` as `applications.external_id` (which is what makes a later automation
sync merge into this row instead of creating a duplicate), then writes the
Supabase rows.

There are two flows, and the dashboard doesn't have to be told which one it's
in — it registers, then asks the backend whether the app is ready:

1. **App isn't on the backend yet.** The registration creates the config
   entry. The backend fills it out to match the existing roster — the shared
   launch check from `configs/split/ios/templates.yaml` and the WebDriverAgent
   bundle id from `device.updated_wda_bundle_id` — so a minimal request still
   produces a conventional entry that a person can hand-edit afterwards.
   Provisioning comes back `pending`, so an `app_provisioning` ticket is
   opened and the assessment shows setup progress.
2. **App is already on the backend**, set up ahead of time through the config
   API or by editing YAML. Registration returns `409` naming the existing
   `app_id`, which is adopted as `external_id`. Provisioning comes back
   `ready`, so **no ticket is created** (`addApp` returns `ticket: null`) and
   the assessment is immediately testable.

A freshly-registered app whose build already happens to be in intake also
lands in case 2 — readiness is asked of the backend, never inferred from
whether registration was new. Rollback on a later Supabase failure only
deletes an app this call actually created, never an adopted one.

**Nothing is uploaded from the dashboard, and nothing in the dashboard ever
asserts which bundle ID belongs to which app.** iOS builds are obtained by
installing the app from the App Store onto the test device under the test
Apple ID and extracting the IPA off it — a manual step, done by whoever owns
the device, who drops the file into the backend's `intake/ios/ipas/`. The app
is registered against the `intake_ipa` artifact source with **no identity at
all**:

```json
{ "name": "CPF Mobile", "version": "6.28.1",
  "artifact": { "source": "intake_ipa" },
  "risks": { "ios-feature-01-risk-01": { "enabled": true } } }
```

The backend matches that name against each intake build's own
`CFBundleDisplayName` (case-, space- and punctuation-insensitive) and resolves
the bundle ID from the winning file. Several versions of one app resolve to the
newest; several *different* apps sharing a name resolve to **ambiguous**, never
a guess, because a wrong name-to-bundle-ID association means silently testing
the wrong app. The resolution happens in one place —
`resolve_intake_ipa` — used by config validation, the provisioning endpoint and
the run itself, so readiness can never disagree with what a run would do.

That entry is written once and never edited, including across version bumps:
drop a newer extraction in and it's picked up. The dashboard mirrors the
resolved bundle ID into `applications.identifier` for display only.

Android still takes a typed `package_name`, which is public information; its
APK is pulled off the device at run time.

Risks are enabled explicitly for the whole catalogue, because iOS defaults an
omitted `risks` map to *nothing* enabled — which would register an app no run
could test.

`GET /config/{platform}/apps/{app_id}/provisioning` is then polled (every 30s,
only while an app is `pending`) for the authoritative readiness answer. It
reports three setup stages that complete independently of one another —
`app_registered`, `service_online`, `configuration_applied` — and
`EnvironmentSetupStages` appends two more that run in order after them,
derived from the assessment's own progress rather than the backend:
automated testing, then analysis & reporting.

Stage states are `done` / `in_progress` / `pending` / `failed` / `unknown`;
overall `status` is `failed` if any stage failed, `ready` if all are `done` or
`unknown`, else `pending`. `unknown` deliberately doesn't block `ready` — an
unverifiable check (Android needs a device plugged in) must not strand an app
in setup forever.

**Stage text is rendered directly in the UI, so it discloses nothing about how
the backend works** — no paths, filenames, config field names, risk ids or
bundle ids. The specifics go to the backend's own logger. `bundle_id` comes
back as its own field for the dashboard to store in
`applications.identifier`; it is not display text.

The dashboard mirrors that verdict into `applications.provisioning_status`
(`0011_application_provisioning.sql`) so other sessions see it without polling
too. **The backend never writes to Supabase** — the dashboard polls and writes
under the user's own session, so RLS stays the authorization boundary. A
`null` provisioning_status means the backend isn't tracking this app, and the
UI falls back to the `app_provisioning` ticket as its readiness signal.

Every one of these calls degrades rather than blocks: if the backend is
unreachable or predates these endpoints (`404`/`501`/no response), the app is
still created dashboard-side exactly as before. A *rejection* (4xx with a
validation detail) is surfaced to the user instead, since that's actionable —
`isBackendUnavailable` / `describeAutomationError` in
`src/api/automation-services.ts` draw that line.

## Idempotent sync

`src/data/sync.ts` is the single place that writes automation results into
Supabase. It uses stable external IDs (`applications.external_id` = the
backend's `app_id`; `findings.external_id` = `"<app_id>::<test_id>"`) so
re-syncing the same run never creates duplicate applications, assessments,
or findings — it updates the existing rows and writes a `finding_history`
entry only when the status actually changed.

Assessments are keyed `"<run_timestamp>::<app_id>"`, but a dashboard-created
one starts as `"manual::<uuid>"`. The first run to sync **adopts that
placeholder** — same row, re-keyed to the run — so the assessment somebody is
already looking at completes in place instead of a second row appearing beside
it, and its findings stay attached to the same id. Later runs then get their
own rows, which is what keeps per-run history. A re-sync of a run that already
has a row updates it rather than adopting anything.

## Starting tests

Two things start automated testing:

1. **Automatically, once setup completes.** `AssessmentDetail` watches the
   provisioning result and calls `syncService.runAllTests`, which runs every
   risk for the app. It fires only when the backend reports `ready` **and no
   stage is `unknown`** — an unverified stage (no device connected, say)
   doesn't block the overall status but must not trigger an unattended run
   against real hardware.
2. **Manually, per risk.** "Run Again" on a test page re-runs that one test and
   updates its result, for when a tester wants to recheck a specific risk.

`runAllTests` claims the assessment first — a conditional update from `queued`
to `running`, which Postgres makes atomic — so several people with the page
open cannot each start their own run. A failure to start releases the claim:
back to `queued` when the backend was merely busy with another run for that
platform (`409`, one run per platform at a time), so a later attempt retries,
and `failed` otherwise. A run that outlives the poll window keeps `running`
rather than being reset into a retry loop.

Two different patterns trigger a sync, depending on the page:

- **Assessments page ("Run Automated Test")** is fire-and-forget: it calls
  `POST /runs` directly and closes its dialog immediately — no
  existing assessment is required, this is how the first assessment for an
  app gets created at all. Progress is watched separately, by the
  "Automation Runs" panel polling `GET /runs` every 5s
  (`useAutomationRuns`). A `useEffect` in `src/pages/Assessments.tsx`
  watches that same polled list and calls `syncService.syncReport()`
  automatically the moment a run it hasn't synced yet turns `"completed"`
  — a `syncingRef` set prevents re-triggering it on every poll and lets a
  failed attempt retry on the next one, rather than giving up permanently.
- **Test Workspace and "Run Retest" on a ticket** still use
  `syncService.runAndSync()`, the blocking start → poll → sync sequence,
  since those pages are already focused on watching one specific run to
  completion (with a "Stop waiting" escape hatch if it takes too long —
  see [CONFIGURATION.md](./CONFIGURATION.md)).

Only Security Team (`run_test` capability) can trigger any of these — RLS
enforces this independently on the Supabase writes.

Separately, `/runs/:runTimestamp` (`src/pages/RunDetail.tsx`) is a
read-only view of one run's live status and full result summary — one row
per (app, risk) tested, each with its real verdict — built straight from
the backend (`useRunStatus` + `useRunResults`) rather than from whatever
has synced into Supabase, so it works even before/without a sync.

## Risk text comes from the playbook

Everything the dashboard *displays* about a risk — `name`, `description`,
`goal`, `tactic`, `demonstration` — is authored in the backend's
`configs/split/{platform}/risks.yaml` and transcribed from that risk's page in
the security playbook. The backend's Python risk classes carry none of it;
they hold only the flags that change what a run does. So correcting what a
tester reads is a YAML edit on the backend, never a dashboard change.

This matters because the two used to disagree: the playbook said one thing,
the risk class said another, and the dashboard was showing the class's
version. `GET /platforms/{platform}/risks` now overlays the YAML entry, so the
catalogue is the playbook's wording.

`tactic` (MITRE ATT&CK Mobile, e.g. `"Discovery"`, or `null` when the risk
isn't mapped) replaced the old `mitre_attack_mobile_technique_id` field.

## Manual testing steps

`/assessments/:assessmentId/tests/:testId/manual`
(`src/pages/ManualTestSteps.tsx`) renders the demonstration from that same
catalogue. There is no separate request: `demonstration` arrives with the
risks the page is already holding.

Step text, table cells and image captions carry the playbook's own inline
markdown, rendered by `renderInline` in `src/lib/inline-markdown.tsx`. It
handles exactly three things — `` `code spans` ``, `**bold**`, and both
`[labelled](https://…)` and bare `https://…` links — deliberately not a
general markdown parser. Underscore emphasis and lone asterisks are left
literal, because step text is full of identifiers like `record_lead_in` and
globs like `*.apple.com` that a fuller parser would mangle into italics. Links
open in a new tab and are restricted to `http`/`https`, so a config entry
can't smuggle in a `javascript:` URL.

A `demonstration` is an ordered list of blocks, each `type: "table"` (setup
rows, rendered as a label/value table from the row keys) or `type: "steps"`
(numbered steps, each with optional shell/code `commands` and `images`).
Unrecognised block types render as nothing rather than breaking the page, so
the backend can add a block type before the dashboard understands it.

Screenshots live in the playbook itself, not in this repo. Each image carries
a backend-relative `url` plus an `exists` flag resolved at request time;
`automationAssetUrl` in `src/api/automation-client.ts` joins the `url` onto
`VITE_API_BASE_URL`. When `exists` is false — a moved or renamed playbook —
the page shows a placeholder in the image's slot instead of a broken image,
which is why the flag is worth having.

`ios-feature-99-risk-01` is the manual-only placeholder risk. Its
demonstration is a stub with one step and no images, so it exercises this page
end to end without depending on any real playbook file.

## CORS

The backend allows browser origins via `CORSMiddleware`, defaulting to
`http://localhost:5173` / `http://127.0.0.1:5173` and overridable with the
`CORS_ALLOWED_ORIGINS` env var (comma-separated). If the dashboard is served
from any other origin, set that variable on the backend — otherwise every
request is blocked by the browser before it reaches the API, and the page
looks empty rather than broken. The dashboard shows an explicit error banner
when these calls fail (see `src/pages/Assessments.tsx`), but the fix is
backend-side configuration.

## Known gaps / recommended backend additions

1. **Verdict not in the summary endpoint.** The authoritative 3-way verdict
   (`"At Risk"` / `"Reduced Risk"` / `"Inconclusive"`) is not included in
   `dashboard_results.json` — it only exists inside each risk's own
   `report.json`
   (`<run_timestamp>/<platform>/<app_id>/<risk_id>/<test_case>/report.json`).
   The dashboard fetches that file per result row to read `verdict`
   (`src/api/automation-services.ts#getResultDetail`,
   `src/data/sync.ts#mapVerdictToFindingStatus`). This works today, but
   means the sync does one extra HTTP request per test result. Adding
   `verdict` directly to `dashboard_results.json` would remove that
   overhead.
2. **No cross-run test history endpoint.** There is no endpoint to fetch
   "history of one test across runs" — the dashboard fans out across the
   most recent 20 `reports/` entries and filters client-side
   (`src/hooks/queries.ts#useTestRunHistory`). A dedicated
   `GET /apps/{app_id}/risks/{risk_id}/history` endpoint would remove that
   fan-out.
3. **Evidence outside `reports/`.** Evidence paths recorded under `work/`
   (as opposed to inside a `reports/<run_timestamp>/` directory) are not
   retrievable through the current `/reports/{run_timestamp}/files/{path}`
   endpoint at all.
4. **No authentication on the automation API.** Fine for local/trusted-network
   use, but anything beyond that needs a reverse proxy or backend change.
