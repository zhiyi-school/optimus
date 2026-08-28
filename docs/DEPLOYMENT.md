# Deployment & Troubleshooting

## Environment Variables

```env
VITE_API_BASE_URL=http://localhost:8080

VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

VITE_APP_NAME=Mobile Application Security Assessment
```

`VITE_API_BASE_URL` is the automation backend's FastAPI server
(`python -m mobile_playbook.api --port 8080` in that project). **Never**
put `SUPABASE_SERVICE_ROLE_KEY` in this file or anywhere under `VITE_*` —
it must never reach the browser. This project never references it.

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
  --build-arg VITE_API_BASE_URL=https://automation.example.com \
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
  existing automation reports.
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
  is running and `VITE_API_BASE_URL` matches its host/port; the backend has
  no authentication of its own, so no API key is needed, but it does need
  to be reachable from the browser running the dashboard.
- **Assessments page looks empty/disconnected, "Automation Runs" panel
  never appears, browser console shows a CORS error** — the automation
  backend has no CORS middleware by default, so the browser blocks every
  request to it. This is a backend-side fix, not a dashboard config issue
  — see [AUTOMATION_API.md](./AUTOMATION_API.md#required-backend-change-enable-cors).
