# Setup

Getting the dashboard running: Node dependencies, environment variables, a
Supabase project with migrations applied, and the automation backend connected.
Configuration that is not an environment variable lives in
[configuration.md](./configuration.md); deployment topologies live in
[deployment.md](./deployment.md).

All examples use placeholders — `Example App`, `example-app`,
`com.example.placeholder`, `https://dashboard.example.com`, `<RUN_ID>`.

## What you need

| | Requirement |
| --- | --- |
| Node.js | 20 or newer (Vite 7 requirement), with npm |
| Supabase | a project with `supabase/migrations/*.sql` applied |
| Automation backend | only for automation features — the dashboard renders existing Supabase data without it |

## 1. Install and configure

```bash
npm install
cp .env.example .env
```

`.env`:

```env
VITE_API_BASE_URL=http://localhost:8080
VITE_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<ANON_KEY>
VITE_APP_NAME=Mobile Application Security Assessment
```

Every `VITE_` variable is **compiled into the browser bundle and is public**.
Use the Supabase `anon` key, which row-level security constrains. The
`service_role` key must never appear here — it belongs only to the automation
host's sync worker.

Variables are read at build time, so a change requires restarting `npm run dev`
or rebuilding.

## 2. Supabase project

Use hosted Supabase because multiple users need shared, persistent data.
A local Supabase (CLI) option is documented at the bottom for development.

### Hosted project

1. **Create the project** at [supabase.com](https://supabase.com) (free
   tier is sufficient to start).
2. **Apply the schema**: in the Supabase SQL Editor, run the files in
   `supabase/migrations/` **in order**, from `0001_schema.sql` through the
   highest-numbered file present. `0013_sync_idempotency_keys.sql` adds the
   `sync_key` columns the dashboard sync worker writes; until it is applied
   the worker fails with `column ... does not exist`.
   (Or, with the Supabase CLI linked to your project: `supabase db push`.)
   Migrations are additive — if you already applied earlier ones, just run
   whichever ones are new.

   The SQL Editor will prompt you to enable Row Level Security before
   running `0001_schema.sql` (it creates tables with no policies yet) —
   choose **Enable RLS**. That locks the tables down completely until
   `0002_rls.sql` adds the real policies immediately after; the
   alternative briefly leaves every table open to the `anon`/`authenticated`
   keys, which is worse even for a few minutes.
3. **Configure authentication**: Authentication → Providers → ensure
   Email is enabled. Turn off "Confirm email" while testing locally if you
   want to sign in immediately after sign-up, or configure an SMTP
   provider for production.
4. **Storage buckets**: already created by `0003_storage.sql`
   (`ticket-attachments`, `evidence`, both private). Nothing further to do
   unless you want custom size/MIME limits (Storage → bucket settings).
5. **Create the first users**: Authentication → Users → Add user (or have
   them sign up through the dashboard's login screen once you point it at
   this project). Each gets a `developer` profile automatically.
6. **Bootstrap your first admin**: run the following SQL once, for
   yourself or whoever will manage the dashboard day-to-day.

   ```sql
   update public.profiles
   set roles = array['admin']
   where email = 'admin@example.com';
   ```

   Give them `security` too in the same statement
   (`array['admin', 'security']`) if that's also true — a user can hold
   multiple roles. Once you have one `admin`, they can do everything else
   from the dashboard's **Admin** page (`/admin`): assign roles to other
   users (including promoting more admins), create teams, assign users and
   applications to teams, and activate/deactivate accounts. You should not
   need to touch SQL for role management again after this step.

7. **Get your API keys**: Project Settings → API → copy the Project URL
   and the `anon` `public` key.
8. **Configure `.env`**: see the root README for the exact variables. Use
   the `anon` key only — never the `service_role` key.

### Role assignment

Every new sign-up automatically gets a `profiles` row with the
least-privileged role, `developer` (see the `handle_new_user` trigger in
`0001_schema.sql`). Getting your first `admin` requires direct SQL access,
as above — after that, `admin` users manage everyone else's roles from the
Admin page.

Two safeguards stay true regardless of who's asking, enforced by the
`prevent_role_escalation` trigger (`0002_rls.sql`, updated in
`0006_multi_role_admin.sql`):

- **`id` can never change**, for anyone, ever, through the app.
- **No one can change their own `roles`** — not even an admin. Changing
  someone else's roles requires the `admin` role; changing your own always
  requires a *different* admin (or direct database access). This means a
  single compromised or malicious admin session can grant roles to other
  accounts but can never escalate itself further, and can't quietly
  remove evidence of its own role by editing it away.

`is_active` is the one field where the rule is looser: any `admin` can
suspend or reinstate *any* account, including their own — that only
removes or restores access already implied by the account's existing
roles, never grants a new one, so the self-change restriction doesn't
apply to it.

### Optional: local Supabase (CLI)

```bash
npx supabase init          # if you don't already have a supabase/ CLI config
npx supabase start         # starts local Postgres, Auth, Storage, Studio
npx supabase db push       # applies supabase/migrations/*.sql
```

Local Studio prints a local URL/anon key on `supabase start` — put those in
`.env`. Local Supabase is useful for development but every dashboard user
needs to hit the *same* Supabase project, so use hosted Supabase for any
real multi-user usage.

### Schema reference

See `supabase/migrations/0001_schema.sql` for the authoritative schema and
`0002_rls.sql` / `0003_storage.sql` for row-level security and storage
policies — see [ARCHITECTURE.md](./architecture.md) for the entity diagram
and data-ownership summary.

## 3. Connect the automation backend

The dashboard's automation features call the backend over HTTP at
`VITE_API_BASE_URL`. Start it in the backend repository:

```bash
python -m mobile_playbook.api --port 8080
```

Then allow this dashboard's exact origin on the backend, in its `.env`:

```env
CORS_ALLOWED_ORIGINS="http://localhost:5173"
```

Exact origins only — scheme, host and port must all match, and `*` is rejected.
An exported shell variable of the same name takes precedence over the backend's
`.env`.

## 4. Start and verify

```bash
npm run dev
```

Work through these in order; each one isolates a different failure.

| # | Check | Expected | If it fails |
| --- | --- | --- | --- |
| 1 | `curl $VITE_API_BASE_URL/health` | `{"status":"ok"}` | backend not running, or wrong port |
| 2 | Sign in at <http://localhost:5173> | the dashboard loads | Supabase URL/anon key, or no user created |
| 3 | Open an assessment | the risk catalogue lists risks | backend unreachable, or a CORS block — check the browser console |
| 4 | Applications list | apps appear | backend `GET /config/{platform}/apps`, or Supabase RLS |
| 5 | Start a test run | the button enables and a run starts | `409` means a run is already in progress on that platform |
| 6 | Live progress | the timeline fills in | SSE blocked by a proxy; polling still reports completion |
| 7 | Automation status | the run reaches `completed` | the backend's own logs |
| 8 | Dashboard sync status | "Dashboard sync queued" → "Dashboard updated" | see the backend's `operations.md` |
| 9 | Findings, history, reports, evidence | populated after sync completes | sync status will name the failure |

Before a device is available, a backend dry run is the safe way to check
plumbing:

```bash
python -m mobile_playbook run --platform <PLATFORM> --config configs/<PLATFORM>.yaml \
  --risks <RISK_ID> --dry-run --out reports
```

## What works without what

```text
Backend can operate without the frontend.
Frontend can display existing Supabase data without running automation.
Frontend automation features require the backend API.
Dashboard synchronisation requires the worker and Supabase.
A replacement API server must implement the documented contract.
```

Troubleshooting the seam between the two:
[frontend-integration.md](./frontend-integration.md#troubleshooting).
