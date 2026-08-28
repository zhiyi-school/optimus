# Configuration

Environment variables (`VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, etc.) are
covered in [DEPLOYMENT.md](./DEPLOYMENT.md#environment-variables). This
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

`src/api/automation-client.ts` sets a 30-second axios timeout on every
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

## Run polling (start → poll → sync)

`src/data/sync.ts`'s `runAndSync` — the shared logic behind every "Run
Automated Test" / "Run Retest" action — polls the backend for run status
rather than waiting on a single long request:

```ts
const RUN_POLL_INTERVAL_MS = 3000;   // poll every 3s
const RUN_POLL_MAX_ATTEMPTS = 120;   // give up after 120 polls (~6 minutes)
```

If a real automated test run can legitimately take longer than 6 minutes,
raise `RUN_POLL_MAX_ATTEMPTS` (or lower `RUN_POLL_INTERVAL_MS` for more
responsive UI updates at the cost of more requests). Hitting the limit
doesn't cancel the backend run — it just means the dashboard stops waiting
and reports it as not-yet-synced; re-syncing later from the Assessments
page will still pick up the result once it exists.

Every "Running…" button also has a **Stop waiting** action next to it
(`RunCancelToken` in `src/data/sync.ts`) — it stops the dashboard's polling
loop early without pretending to cancel anything on the backend (there's
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

## Live-ish polling elsewhere

- **Automation Runs panel** (Assessments page): refetches every 5 seconds
  while the page is open (`useAutomationRuns`, `src/hooks/queries.ts`).
- **Ticket messages**: not polled — pushed instantly via a Supabase
  Realtime subscription (`messageData.subscribeToTicket`,
  `src/data/services.ts`).

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

`src/data/supabase.ts` configures the auth client:

```ts
auth: {
  persistSession: true,     // keep the session in localStorage across reloads
  autoRefreshToken: true,   // silently refresh before the JWT expires
},
```
