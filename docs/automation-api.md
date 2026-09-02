# Automation API Integration

The dashboard talks to the automation backend's FastAPI endpoints
(`mobile_playbook/api/app.py`, documented in that project's `docs/api.md`):
`GET /platforms/{platform}/risks` (test catalogue), `GET /config/{platform}/apps`
(configured app roster, used to populate the app multi-select when starting a
run), `POST /runs` / `GET /runs/{id}` (start/poll a run), `GET /reports` /
`GET /reports/{run_timestamp}/summary` (results), and
`GET /reports/{run_timestamp}/files/{path}` / `GET /reports/{run_timestamp}/evidence-file`
(evidence files). Per-app risk history comes from
`GET /apps/{app_id}/risks/{risk_id}/history`.

The backend is designed for localhost or a trusted lab network. If
`VITE_API_BASE_URL` points anywhere else, that URL should be an
authenticated VPN or reverse-proxy entrypoint, not the bare FastAPI server.

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
{ "name": "Example App", "version": "1.2.3",
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
too. The unauthenticated automation API never writes to Supabase; durable
report sync is handled by a separate worker process that holds the
service-role key outside the browser and outside the API server. A `null`
provisioning_status means the backend isn't tracking this app, and the UI
falls back to the `app_provisioning` ticket as its readiness signal.

Every one of these calls degrades rather than blocks: if the backend is
unreachable or predates these endpoints (`404`/`501`/no response), the app is
still created dashboard-side exactly as before. A *rejection* (4xx with a
validation detail) is surfaced to the user instead, since that's actionable —
`isBackendUnavailable` / `describeAutomationError` in
`src/api/automation-services.ts` draw that line.

## Application icons

The backend owns the IPA/APK and the icon extracted from it. Supabase holds only
`applications.icon_ref` (`icons/<ARTIFACT_ID>.png`), `artifact_sha256` and
`icon_extraction_status`; the dashboard never reads a build, parses an image, or
stores image data.

`src/lib/application-icon.ts` turns a row into a URL, and
`src/components/application-icon.tsx` renders it:

```ts
applicationIconUrl(application)
// -> "<VITE_API_BASE_URL>/config/<platform>/apps/<APP_ID>/icon"  when an icon exists
// -> null                                                        otherwise
```

The URL is derived from `applications.platform` and `applications.external_id` —
identifiers the dashboard already holds — so `icon_ref` never appears in it. It
exists to answer "is there an icon?" without a request. `artifact_sha256` is
appended as `?v=<checksum>`, which changes the URL whenever the underlying build
changes, so a browser can never keep serving a previous build's icon from cache.
The backend storage path and the `icons/<ARTIFACT_ID>.png` reference stay out of
the DOM entirely. `applicationIconUrl`
returns null, and no request is made at all, when the application has no
`external_id`, has no `icon_ref`, or has an `icon_extraction_status` the backend
already reported as `unavailable` or `failed`. Rows predating icon support have
all three null and fall into the same path.

`<ApplicationIcon application={...} />` is the only place icon behaviour lives.
It renders the backend image when there is one and the existing
`appTypeIcon` placeholder otherwise — for a missing reference, for a `404`, and
for any image that fails to load, since it falls back on the `<img>` `onError`
too. A backend that is down, an icon that was cleaned out of the store, and an
app that never had one all look the same to the reader: the placeholder. It is used everywhere an application identity appears — the assessments list,
the assessment sidebar, the findings and tickets tables, ticket detail, and the
admin applications table — and any new surface should use it rather than
reaching for `appTypeIcon` directly. A test enumerates those files and fails if
one of them hand-rolls the placeholder instead.

Nothing about an assessment depends on an icon. The icon request is a plain
`<img>` outside React Query, so it cannot fail a query, block a render, or put a
page into an error state.

### Which build's icon you are looking at

An icon is bound to the build a run actually executed against, not to whatever
is on the automation host now. The run records that artifact's SHA-256 and the
sync worker links the icon derived from that exact checksum, so uploading a new
build does not retroactively change a finished assessment's icon. `artifact_sha256`
on the row tells you which build you are seeing. If the recorded build's icon is
missing from the store, the previous reference is left in place rather than
replaced with a different build's.

### Backfilling

Applications created before icon support keep `icon_ref = null` until something
fills it in. Two things do, both on the automation host:

- **A dashboard sync pass**, which writes the reference alongside the rest of the
  application row. Nothing extra to run.
- **A one-time sweep**, for filling in a whole existing roster at once:

  ```bash
  python -m mobile_playbook.icon_backfill --dry-run
  python -m mobile_playbook.icon_backfill
  ```

  It matches on backend id **and** platform first, then falls back to a single
  unlinked row with the same name and platform. Several matches are reported as
  ambiguous and skipped rather than guessed at.

The dashboard has no icon-refresh action, by design: extraction reads
backend-owned build files, so it stays an operator task on the host that owns
them. The frontend only ever reads an icon. No scan of stored artifacts happens
during ordinary dashboard loading, and every extraction result is cached by
artifact checksum on the backend.

### For a replacement backend

A different backend can serve this contract by exposing one endpoint:

```text
GET /config/{platform}/apps/{app_id}/icon
  200  image/png
  404  unknown app, or no icon available
```

An `ETag` and `Cache-Control` are expected but optional. That is the whole
contract — the dashboard never POSTs to it. If `icon_ref` is never written to
Supabase the dashboard simply shows placeholders, and no other behaviour
changes.


## Idempotent sync

The automation host's `mobile_playbook/dashboard_sync.py` worker is the only
writer of automation results into Supabase. Nothing in the browser writes them:
the dashboard starts runs, watches progress, and reads what the worker has
already published. This matters for more than tidiness — the worker holds the
service-role key, and moving that anywhere a browser can reach would hand every
visitor a key that bypasses row-level security.

The worker uses stable external IDs (`applications.external_id` = the backend's
`app_id`; `findings.external_id` = `"<app_id>::<test_id>"`) so re-syncing the
same run never creates duplicate applications, assessments, or findings — it
updates the existing rows and writes a `finding_history` entry only when the
status actually changed. A processed ledger keyed by run timestamp and report
digest skips work that already landed, and `finding_history`/`activity_log`
rows carry a deterministic `sync_key` with a unique index behind it, so even a
duplicate worker cannot double-write them.

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
and `failed` otherwise. Giving up on *watching* a run is not the same as the run
failing: `cancelledWaiting` and `timedOutWaiting` mean only that this browser
stopped following along, so neither writes a terminal status. The run keeps going
on the automation host, and the dashboard sync worker records its result when it
finishes. A real `POST /runs/{id}/cancel` endpoint is out of scope for this phase.

Nothing in the browser writes results. The dashboard sync worker on the
automation host is the only writer, so a page that stops watching — or is closed
altogether — costs nothing but the live progress view.

### Picking a run back up

Because the browser is only ever an observer, "is a run in progress?" cannot live
in React state: unmounting a page would lose it, and a second person opening the
same page would never see it at all. Instead `useActiveRun` polls `GET /runs`
every 5s and `findActiveRun` (`src/data/sync/runs.ts`) picks out the record that
is still `running` and whose `apps`/`risks` selection covers the app and risk the
page is showing. A `null` selection covers everything, mirroring the backend's
`--apps`/`--risks` defaults.

Finding the run is only half of it. One physical device drives one test at a
time, so a run started for four risks has one executing and three waiting — being
*covered by* a run is not the same as *being run*. `riskProgressInRun` settles
which of the three it is from the run's own event log: a `risk_completed` for
this (app, risk) means `done`, a `risk_started` without one means `running`, and
neither means `queued`. Reconnecting to the run's `EventSource` replays the whole
`reports/{run_id}/events.jsonl` from the start, so a page that arrives mid-run
classifies itself correctly rather than assuming it is next.

`TestDetail` and the "Run Retest" dialog show live progress only for `running`,
say plainly that the test is waiting its turn for `queued`, and stop showing
either once this risk is `done` even though the run continues with other risks.
Both merge that with a local `watching` flag covering the gap between clicking
the button and the run appearing in the list. "Stop waiting" records the run id
it dismissed so the poll does not immediately re-adopt it.

Both routes for the test page share one `<TestDetail />` element, so switching
between two tests changes `:testId` without unmounting anything. `TestDetail`
therefore renders its body keyed by `testId`: without that key the previous
test's "I started this" flag, run id and error survive into the next test, which
then claims to be running when it is not. Starting a run also invalidates the
shared `automationRuns` query so other pages see the busy device immediately
rather than up to one poll interval later.

`findPlatformRun` answers a different question: whether *any* run holds this
platform's device. `POST /runs` rejects a second run for a busy platform with
`409`, so the button is disabled with "Device busy" rather than letting the click
fail. That covers a run for a different app entirely, and also the case where
this risk has already finished but its run is still working through the rest.

Only Security Team (`run_test` capability) can trigger any of these — RLS
enforces this independently on the Supabase writes.

Separately, `/runs/:runTimestamp` (`src/pages/RunDetail.tsx`) is a
read-only view of one run's live status and full result summary — one row
per (app, risk) tested, each with its real `verdict` — built straight from
the backend (`useRunStatus` + `useRunResults`) rather than from whatever
has synced into Supabase, so it works even before/without a sync. While a
run is active, focused run views also open `GET /runs/{run_id}/events` with
`EventSource` to render live progress events; regular `GET /runs/{run_id}`
polling stays enabled as the fallback and remains the source of truth for
completion.

### Dashboard sync status

A run finishing is not the same as the dashboard being current. The worker
publishes results after the run ends, so there is a window — usually seconds —
where `GET /runs/{run_id}` says `completed` while Supabase still holds the
previous state. That window is what made results look "missing" right after a
run, so it is now shown rather than hidden.

`useRunSyncStatus(runId)` polls `GET /runs/{run_id}/sync-status` every 4s while
the sync is `queued` or `running`, and stops on `completed`, `failed` or
`not_required`. `syncPollInterval` in `src/lib/dashboard-sync.ts` is that rule as
a plain function, so the start/stop behaviour is tested directly. A backend with
no record for the run — an older API, or a report predating the feature —
returns `null` through `syncApi.getRunSyncStatus` rather than an error, and the
UI simply shows nothing.

When the status reaches `completed`, the hook invalidates the Supabase-backed
queries the worker rewrites: findings and their history, retests, assessments,
tickets, activity and the dashboard metrics. That is the only refresh mechanism —
the browser still never writes a report to Supabase, and nothing here reads the
service-role key, which exists only in the worker's own process environment.

`DashboardSyncNotice` renders the five states as "Dashboard sync queued", "…in
progress", "Dashboard updated", "Dashboard sync failed" and "Dashboard sync not
required". A failed sync says explicitly that the run itself is intact, because
the run's own results and evidence keep rendering from the backend either way.
A retry button appears only when the status is `failed` **and** `retryable` is
true — an ambiguous-application failure needs a person to resolve it, so the
backend marks it non-retryable and no button is offered. Retrying calls
`POST /runs/{run_id}/sync`, which queues another worker pass without `--force`,
so a report that already landed is skipped by the ledger instead of written
twice.

Giving up locally is still not a failure. `runAndWait`'s `cancelledWaiting` and
`timedOutWaiting` outcomes report `dashboardSyncPending: false` and write no
terminal state anywhere; the run and its sync both continue on the automation
host, and reopening the page picks both back up.

### SARIF download

`RunDetail` offers a "Download SARIF" action for completed runs, so a run's
results can be handed to any tool that speaks the SARIF 2.1.0 interchange
format. `canExportSarif` in `src/lib/sarif.ts` gates it on the run's status:
only a `completed` run has the manifest the backend requires, so the button is
absent for a run that is still going or that failed, rather than offering a
download that would 404.

The click calls `assessmentApi.downloadReportSarif`, which requests
`GET /reports/{run_timestamp}/sarif` with `responseType: "blob"`. Fetching bytes
rather than JSON means the browser never parses SARIF — it only hands the file
to the user. A run the backend has no export for comes back as `null` rather
than throwing, and the button shows "No SARIF export is available for this run."
`assessmentApi.reportSarifUrl(runTimestamp)` builds the same URL for anywhere a
plain link is wanted.

SARIF is an export only. Findings, tickets, history and activity continue to
come from Supabase exactly as before, populated by the automation host's worker;
nothing in the browser reads SARIF back into the dashboard, and this path
touches no backend credential.

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

## Developer remediation controls

The risk text above describes the problem and how security demonstrates it. The
control endpoints describe what a developer changes to fix it, read by the
backend from an external playbook directory it never writes to.

```text
GET /platforms/{platform}/risks                                          controls[] summaries
GET /platforms/{platform}/risks/{risk_id}/controls                       full control list
GET /platforms/{platform}/controls/{control_id}                          one control's steps
GET /platforms/{platform}/controls/{control_id}/assets/{asset_path}      one screenshot
GET /platforms/{platform}/controls/{control_id}/source                   archive metadata
GET /platforms/{platform}/controls/{control_id}/source/download          the archive
GET /platforms/{platform}/playbook/status                                diagnostics
```

`src/api/playbook-services.ts` is the only place these are called from; the
response shapes are in `src/api/playbook-types.ts`.

**The dashboard never parses playbook Markdown.** A control's steps arrive as
typed blocks — `paragraph`, `caption`, `heading`, `code`, `list`, `table`,
`image` — and `src/lib/playbook.ts` filters them against an allowlist before
`src/components/playbook-content.tsx` renders them. Any block kind the backend
grows later is dropped rather than passed through, nothing is ever injected as
raw HTML, and `renderInline()` only produces links for `http`/`https` URLs, so a
`javascript:` or `data:` target in the playbook cannot become an anchor.

**No filesystem path from the playbook reaches this code.** Image blocks carry a
backend-relative `url`, which `automationAssetUrl()` resolves against
`VITE_API_BASE_URL`. The playbook's location on the automation host is the
backend's business and is configured there
(`IOS_PLAYBOOK_DIR` / `ANDROID_PLAYBOOK_DIR`).

### Degrading when the playbook is unavailable

A misconfigured or missing playbook directory must not break the dashboard:

| Situation | What the dashboard does |
|---|---|
| Directory unreadable | `GET /platforms/{platform}/risks` still returns risks with `controls_available: false`; the Resolve pages show an error on the controls card only |
| Control endpoint returns `503` | The control page shows an error with a retry, not an empty step list |
| A screenshot is missing (`exists: false`) | An inline "screenshot unavailable" placeholder in the step, with the caption if there is one |
| A control has no archive | The implementation-example card is not rendered |
| Archive downloads disabled | The filename is shown with a note that downloads are off on that host |
| Backend predates these endpoints (`404`/`405`) | `getStatus`/`getControlSource` resolve to `null` and their cards disappear |

An empty control list is never shown as though the risk simply has no
remediation guidance.

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
backend-side configuration. Use exact origins only; the backend rejects `*`
at startup because its endpoints can write config, start tests, upload
builds, and serve evidence.

## Known gaps / recommended backend additions

1. **No built-in user authentication on the automation API.** Fine for localhost or trusted-network use, but anything beyond that needs an authenticated reverse proxy, VPN, or backend auth change.
