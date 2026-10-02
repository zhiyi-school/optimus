# Configuration

Environment variables (`VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, etc.) are
covered in [deployment.md](./deployment.md#environment-variables). This
doc covers everything else that's configurable but isn't an env var —
ports, hosts, timeouts, and other constants that live directly in source.

## Dev server port / host

`vite.config.ts` hardcodes the dev server port:

```ts
server: {
  port: 5173,
},
```

Change it there, or override per-invocation without touching the file:

```bash
npm run dev -- --port 5180
npm run dev -- --host          # bind 0.0.0.0, expose on your LAN
```

`npm run preview` (serves the production build locally) uses Vite's
default preview port (4173) unless you pass `--port` the same way.

## Production port (Docker / nginx)

The container's nginx (`nginx.conf`) always listens on port **80**
internally — that's not meant to change. What you control is the host-side
mapping:

```bash
docker run -p 3000:80 mobile-security-dashboard   # host:container
```

Change `3000` to whatever host port you want. `nginx.conf` also sets
1-year immutable caching on `/assets/` (Vite's hashed build output) and
falls back every other path to `index.html` for client-side routing —
edit that file directly if you need different caching or routing rules.

## Base path (subpath deployments)

If you're serving the dashboard from a subpath (e.g.
`https://example.com/dashboard/` instead of the domain root), set Vite's
`base` option in `vite.config.ts`:

```ts
export default defineConfig({
  base: "/dashboard/",
  // ...
});
```

Not set by default (defaults to `/`) since most deployments serve this
from the domain root.

## Automation API client timeout

`src/automation-api/client.ts` sets a 30-second axios timeout on every
request to the automation backend:

```ts
export const automationClient: AxiosInstance = axios.create({
  baseURL: baseURL ?? "",
  timeout: 30_000,
});
```

This only bounds a single HTTP request (e.g. fetching a report or the risk
catalogue) — it has nothing to do with how long an automated test itself
is allowed to run (see below).

## Run polling (start → watch)

`src/workflows/automation-run.ts`'s `runAndWait` — behind the single-risk "Run
Automated Test" / "Run Again" button on `src/pages/assess/test-detail.tsx`, its
only caller — polls the backend for run status rather than waiting on a single
long request. Whole-assessment runs don't use it; they go through the
assessment run queue (see
[automation-api.md](./automation-api.md#starting-tests)).

```ts
const RUN_POLL_INTERVAL_MS = 3000;   // poll every 3s
const RUN_POLL_MAX_ATTEMPTS = 120;   // give up after 120 polls (~6 minutes)
```

If a real automated test run can legitimately take longer than 6 minutes,
raise `RUN_POLL_MAX_ATTEMPTS` (or lower `RUN_POLL_INTERVAL_MS` for more
responsive UI updates at the cost of more requests). Hitting the limit
doesn't cancel the backend run and doesn't mark anything failed — it only means
this browser stopped following along. The run finishes on the automation host
and the dashboard sync worker records its result. Reopening the page picks the
run back up: `useActiveRun` finds it again in `GET /runs` by the app and risk it
covers. There is no `POST /runs/{id}/cancel` endpoint in this phase.

The "Running…" button also has a **Stop waiting** action next to it
(`RunCancelToken` in `src/workflows/automation-run.ts`) — it stops the dashboard's
polling loop early without pretending to cancel anything on the backend (there's
no cancel-a-run endpoint), so it's purely a way to get the UI back under
your control before the 6-minute backstop. This matters because the
backend has no automatic failure detection for a hung test setup (e.g. an
Appium/WebDriverAgent launch that never returns) — a run stuck like that
stays reported as `"running"` indefinitely, and since the backend only
allows one run per platform at a time, it also blocks starting any new run
on that platform until the backend process is restarted (its job registry
marks stale `"running"` entries as `failed` on restart, not on any timer).
If runs on a platform seem permanently stuck, restarting the automation
backend is the actual fix — the dashboard has no way to unstick a
backend-side lock.

## Live progress elsewhere

- **Assessment list**: `useAssessments({ pollWhileInProgress: true })`
  (`src/hooks/queries/assessments.ts`), used by the Assessments page, re-reads
  every assessment every 10 seconds (`ASSESSMENT_LIST_POLL_INTERVAL_MS`) while
  any is `queued`, `waiting` or `running`, and stops once all have completed or
  failed. Other callers do not poll.
- **Assessment run request**: `useAssessmentRunRequest`
  (`src/hooks/queries/assessments.ts`) re-reads the assessment's queued run
  request every 10 seconds (`RUN_REQUEST_POLL_INTERVAL_MS = 10_000`) while it or
  the assessment is transitional, and stops once both settle.
- **App provisioning**: `useAppProvisioning` (`src/hooks/queries/automation.ts`)
  polls the provisioning endpoint every 30 seconds
  (`PROVISIONING_POLL_INTERVAL_MS = 30_000`) while the assessment's run is
  unsettled.
- **In-flight run discovery**: `useActiveRun` (`src/hooks/queries/automation.ts`) polls
  `GET /runs` every 5 seconds (`ACTIVE_RUN_POLL_INTERVAL_MS = 5000`) so a page
  that was closed mid-run can pick the run back up. It does not synchronise
  anything — the automation host's worker is the only writer of dashboard rows.
- **Run detail**: `useRunStatus` polls `GET /runs/{run_id}` every 2 seconds
  while the run is `running`, when its caller asks it to poll (the
  `/runs/:runTimestamp` page does).
- **Live run events**: the run detail page and the test page open
  `GET /runs/{run_id}/events` via `EventSource` for live progress while a run is
  active. The run detail page keeps its `GET /runs/{run_id}` polling as the
  fallback if the stream is unavailable or drops; the test page keeps
  `runAndWait`'s `GET /runs/{run_id}` polling and `useActiveRun`'s `GET /runs`.
- **Dashboard sync status**: `useRunSyncStatus` polls
  `GET /runs/{run_id}/sync-status` every 4 seconds
  (`SYNC_STATUS_POLL_INTERVAL_MS = 4000` in `src/domain/run/dashboard-sync.ts`)
  while the sync is `queued` or `running`. While the backend has no record yet
  it stops after `SYNC_STATUS_POLL_MAX_ATTEMPTS` (15) attempts, so a backend
  without the endpoint isn't polled forever.
- **Playbook revision**: `src/hooks/queries/playbook.ts` polls the playbook
  status every 45 seconds (`PLAYBOOK_POLL_INTERVAL_MS = 45_000`) while enabled;
  its control queries use a 5-minute stale time.
- **Reference data and analysis**: profiles, teams and applications
  (`src/hooks/queries/reference.ts`) and a run's analysis document
  (`useIpaAnalysis`) are not polled and stay fresh for 5 minutes.
- **Risk conversations**: not polled — pushed instantly via the scoped Supabase
  Realtime subscription in `src/database/conversations.ts`.

## TanStack Query defaults

Set once in `src/main.tsx` for every query in the app:

```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,          // data considered fresh for 30s
      retry: 1,                   // retry a failed query once
      refetchOnWindowFocus: false,
    },
  },
});
```

## Supabase client session behavior

`src/database/client.ts` configures the auth client:

```ts
auth: {
  persistSession: true,     // keep the session in localStorage across reloads
  autoRefreshToken: true,   // silently refresh before the JWT expires
},
```
