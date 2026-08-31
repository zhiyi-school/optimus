# Deployment & Troubleshooting

## Environment Variables

```env
VITE_API_BASE_URL=http://localhost:8080

VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

VITE_APP_NAME=Mobile Application Security Assessment
```

`VITE_API_BASE_URL` is the automation backend's FastAPI server
(`python -m mobile_playbook.api --port 8080` in that project). Keep that
backend on localhost or a trusted lab network. If the dashboard is hosted
somewhere else, expose the backend only through a VPN or authenticated
reverse proxy. **Never** put `SUPABASE_SERVICE_ROLE_KEY` in this file or
anywhere under `VITE_*` — it must never reach the browser. This project
never references it. Durable backend report sync uses a separate worker
process in the automation repo; put the service-role key only in that
worker's server-side environment.

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
  been synced yet. Run a test from a Test Workspace page, or use "Sync
  reports" on the Assessments page (Security Team only) to pull in
  existing automation reports. For unattended completion sync, run the
  automation repo's dashboard-sync worker against the completed reports.
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
- **Assessments page looks empty/disconnected, "Automation Runs" panel
  never appears, browser console shows a CORS error** — confirm the
  dashboard origin is included in the backend's `CORS_ALLOWED_ORIGINS`.
  The backend defaults to local Vite origins; anything else needs that
  backend-side setting, and wildcard origins are rejected. See
  [AUTOMATION_API.md](./automation-api.md#cors).
