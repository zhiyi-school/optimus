# Supabase Setup

Use hosted Supabase because multiple users need shared, persistent data.
A local Supabase (CLI) option is documented at the bottom for development.

## Hosted setup

1. **Create the project** at [supabase.com](https://supabase.com) (free
   tier is sufficient to start).
2. **Apply the schema**: in the Supabase SQL Editor, run the files in
   `supabase/migrations/` **in order**:
   `0001_schema.sql` → `0002_rls.sql` → `0003_storage.sql` →
   `0004_application_contacts.sql` → `0005_admin_policies.sql` →
   `0006_multi_role_admin.sql`.
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
   where email = 'someone@org.com';
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

## Role Assignment

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

## Optional: local Supabase (Supabase CLI)

```bash
npx supabase init          # if you don't already have a supabase/ CLI config
npx supabase start         # starts local Postgres, Auth, Storage, Studio
npx supabase db push       # applies supabase/migrations/*.sql
```

Local Studio prints a local URL/anon key on `supabase start` — put those in
`.env`. Local Supabase is useful for development but every dashboard user
needs to hit the *same* Supabase project, so use hosted Supabase for any
real multi-user usage.

## Database Schema

See `supabase/migrations/0001_schema.sql` for the authoritative schema and
`0002_rls.sql` / `0003_storage.sql` for row-level security and storage
policies — see [ARCHITECTURE.md](./ARCHITECTURE.md) for the entity diagram
and data-ownership summary.
