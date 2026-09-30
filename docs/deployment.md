# Deployment & Troubleshooting

## Environment Variables

```env
VITE_API_BASE_URL=http://localhost:8080

VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

VITE_APP_NAME=Mobile Application Security Assessment

VITE_DEBUG=false
```

`VITE_API_BASE_URL` is the automation backend's FastAPI server
(`python -m mobile_playbook.api --port 8080` in that project). Keep that
backend on localhost or a trusted lab network. If the dashboard is hosted
somewhere else, expose the backend only through a VPN or authenticated
reverse proxy. **Never** put `SUPABASE_SERVICE_ROLE_KEY` in this file or
anywhere under `VITE_*` — it must never reach the browser. This project
never references it. The automation repo's two worker processes — dashboard
sync and the assessment run queue — use it; put the service-role key only in
those workers' server-side environment.

`VITE_DEBUG=true` turns on verbose, redacting `console.debug` output
(`src/lib/debug.ts`; see [setup.md](./setup.md#debug-logging)). Leave it unset
or `false` in production. The Dockerfile has no `ARG VITE_DEBUG`, so a Docker
build can't set it with `--build-arg`. There is no `.dockerignore` either, so
`COPY . .` brings a local `.env` into the build and Vite reads `VITE_DEBUG`
from it; keep it `false` there before building an image.

## Production Build

```bash
npm run build      # tsc -b && vite build, outputs dist/
npm run preview    # serve the production build locally
```

## Docker

Frontend-only image; Supabase and the automation backend are external
services.

```bash
docker build \
  --build-arg VITE_API_BASE_URL=https://automation-proxy.example.com \
  --build-arg VITE_SUPABASE_URL=https://xxxx.supabase.co \
  --build-arg VITE_SUPABASE_ANON_KEY=xxxx \
  -t mobile-security-dashboard .

docker run -p 3000:80 mobile-security-dashboard
```

## Troubleshooting

- **"VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set"** — copy
  `.env.example` to `.env` and fill in your Supabase project's URL/anon key.
- **Findings/tickets pages are empty even as security/cio** — nothing has
  been synced yet. Adding an app queues its assessment for the automation
  repo's assessment worker (`python -m mobile_playbook.assessment_worker`),
  or a single risk can be run from its test page (Security Team only).
  Findings appear only once the dashboard-sync worker
  (`python -m mobile_playbook.dashboard_sync`) has written the completed
  reports; the Assessments page warns when completed runs have not appeared
  there yet.
- **RLS errors ("new row violates row-level security policy")** — check
  the user's `profiles.roles` and, for developers, `applications.developer_team_id`
  / `profiles.team_id` — developer access is scoped to their own team's
  applications.
- **Developer can't see any findings** — their `profiles.team_id` and the
  application's `applications.developer_team_id` need to point at the same
  team; a freshly created application has no team assigned by default. Fix
  it from the Admin page (`/admin`, requires the `admin` role) — assign the
  developer to a team and the application to that same team.
- **Automation API calls fail with a network error** — confirm the backend
  is running and `VITE_API_BASE_URL` matches its host/port or protected
  proxy URL. The backend has no user authentication of its own; if it is
  reachable beyond localhost or a trusted lab network, the proxy/VPN must
  provide authentication and TLS.
- **Assessments page shows "Can't reach the automation backend", browser
  console shows a CORS error** — confirm the
  dashboard origin is included in the backend's `CORS_ALLOWED_ORIGINS`.
  The backend defaults to local Vite origins; anything else needs that
  backend-side setting, and wildcard origins are rejected. See
  [automation-api.md](./automation-api.md#cors).
