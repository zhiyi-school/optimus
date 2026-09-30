# Database maintenance

## Layout

| Folder | Purpose | Applied to |
| --- | --- | --- |
| `supabase/migrations/` | Fresh-install baseline: the final schema, built directly | New projects only |
| `supabase/fixes/` | Numbered forward corrections not yet folded into the baseline | New projects after the baseline, and live projects |
| `supabase/legacy-migrations/` | The historical chain from `0001`, verbatim, including fixes already folded into the baseline | Nothing new; kept as the record of what live projects ran and for the equivalence test |

The baseline equals the schema of a live project that has applied every file in
`supabase/legacy-migrations/`, except that it never creates the archived `ticket_messages`,
`ticket_attachments` and `assessment_messages` tables or the one-off `0021`
helpers `merge_duplicate_risk_conversations()` and
`place_unlinked_ticket_conversations()`. It contains no data moves or
compatibility guards. Its files are:

| File | Contents |
| --- | --- |
| `0001_extensions_and_tables.sql` | `pgcrypto`, tables, keys, constraints, indexes, column comments |
| `0002_functions.sql` | Access helpers, trigger functions and workflow RPCs |
| `0003_triggers.sql` | Timestamp, profile-creation and workflow-guard triggers |
| `0004_rls_policies.sql` | Row-level security and every table policy |
| `0005_grants.sql` | Execute privileges on workflow RPCs and worker functions |
| `0006_storage.sql` | The private `ticket-attachments` and `evidence` buckets and their object policies |

**New project:** run every file in `supabase/migrations/` in order, then every
file in `supabase/fixes/` in order. **Live project:** run only the files in
`supabase/fixes/` it has not applied yet; never run the baseline against it.
`npx supabase db push` reads only `supabase/migrations/`, so apply fixes with
the SQL Editor or `psql`.

## Disposable verification

Run the complete database contract only with:

```sh
npm run test:database
```

This same maintained command runs in the CI database job. Locally and in CI it
requires Docker and a PostgreSQL 15 image; it never uses a linked Supabase
project or credentials.

The command requires Docker and the literal `--docker` guard embedded in the
package script. It creates a uniquely named PostgreSQL 15 container labelled
`optimus.disposable-database=true`, mounts this checkout read-only, uses only
synthetic identities, and removes the container on success, failure, or an
interrupt. It does not read a Supabase URL, reset an existing local database,
or connect to a live project.

The script verifies these paths:

| Path | Starting point | Coverage |
| --- | --- | --- |
| Fresh installation | Empty database | The baseline, then every fix, the current SQL suites in `supabase/tests/`, and the final-schema assertions |
| Legacy chain | Empty database | Every file in `legacy-migrations/`, with the version-specific suites in `supabase/tests/legacy/` run at the version their fixtures need, then every fix, the current suites and the final-schema assertions |
| Supported upgrade | Schema through `0024` | Synthetic application/team/roles, findings, conversations/events/attachments, remediation tickets including `fix_submitted`, selected controls and completed/incomplete steps, and a historical reassessment; then `0025` onward, every fix, the `0032` move of `fix_submitted` to `in_progress`, and preservation/final-schema assertions |
| Schema equivalence | Fresh and legacy results | `pg_dump --schema-only` of both must match once the archived objects are dropped from the legacy copy |

`0024` is the single supported historical test baseline because `0025`–`0027`
are the documented classification, reassessment, and attachment compatibility
boundary. Older versions are not claimed as tested upgrade origins.

Migration and fix files perform durable schema changes. SQL files in
`supabase/tests/` are assertions against the final schema, with their own
fixtures and final `rollback`. Files in `supabase/tests/legacy/` assert
behaviour that a later migration replaced, so they run only along the legacy
chain. A second tracked pass must apply nothing. Generated IDs, timestamps,
and formatted SQL are deliberately not compared.

## Adding a fix

1. Add the next numbered file to `supabase/fixes/`, continuing after the
   highest number in `supabase/fixes/` or `supabase/legacy-migrations/`. Never
   rewrite a fix that may have been applied.
2. Make legacy-value handling and backfills explicit. Add an upgrade fixture
   assertion when existing rows can be affected.
3. Test the effective final function, trigger, grant, and policy definitions,
   not only the statements in the new file. PostgreSQL/Supabase default grants
   may grant roles directly, so `revoke ... from public` is not always enough.
4. Add or extend an SQL role/workflow test in `supabase/tests/` with explicit
   expected failures. If the fix changes behaviour an existing test asserts,
   update that test.
5. Run `npm run test:database`, the frontend tests, lint, and build.

Do not edit the baseline to carry a fix: fresh installs already get it from
`supabase/fixes/`, and the equivalence check fails if the two disagree.

The repository's SQL-file runner is ordered and tracked, but it is not a
universal rollback system. Files may contain multiple autocommitted statements,
backfills, and irreversible data changes. Production rollback therefore means
a reviewed forward correction or a tested restore plan, not assuming every
fix can be run backward.

## Pending fixes

The notes below describe the files currently in `supabase/fixes/`. Apply each to
every live project.

### Restoring ticket guards (0035)

`0030` replaced `enforce_ticket_update_permissions()` with `create or replace`
to recognise the reassessment reconciler, and the new body left out three guards
that `0026` still had. `0032` and the baseline inherited the gap. From `0030`
onwards a developer with access to the application could, through the REST API,
change a ticket's `type`, `finding_id`, `application_id`, `created_by`,
`assigned_user_id` or `assigned_team_id`, set `closed_at` outside a withdrawal,
and edit `withdrawn_at`, `withdrawn_by` or `withdrawal_reason` after the fact.
The dashboard never makes those writes, so nothing failed; only the legacy
`0017` and `0018` suites asserted the guards, and they run before `0030`.

Fix `0035_restore_ticket_ownership_guards.sql` redefines the function with
the guards restored for callers holding neither `security` nor `admin`:

- withdrawal details are written only by the withdrawing update, which must
  also record `withdrawn_at`;
- only security sets or clears `closed_at`;
- the ownership fields above cannot change.

The reconciler and reassessment-withdrawal paths return before these checks and
are unaffected, as are the service-role workers. The fix changes no rows and
needs no frontend change, so it can be applied at any time.
`supabase/tests/0035_restore_ticket_ownership_guards_rls.sql` and
`final_schema_assert.sql` cover it. When it is folded, the baseline's
`0002_functions.sql` must carry the same function body.

## Re-baselining

Fold fixes into the baseline only when every live project has applied them.

1. Move the folded files from `supabase/fixes/` to
   `supabase/legacy-migrations/`, keeping their numbers. Leave
   `supabase/fixes/.gitkeep` in place so the folder survives being emptied.
2. Apply the same change to the affected baseline file in
   `supabase/migrations/`, as a final definition rather than an extra
   statement. For example, a revoked grant is removed from the baseline's
   grant list.
3. Move tests that no longer hold against the final schema to
   `supabase/tests/legacy/`.
4. Run `npm run test:database`; the equivalence check proves the new baseline.

## Legacy migrations

The notes below describe the rollout of migrations in
`supabase/legacy-migrations/`. Every live project has applied them.

### Retiring `fix_submitted` (0032)

Migration `0032_retire_fix_submitted.sql` retires the `fix_submitted` ticket
status. It:

- moves every `fix_submitted` ticket to `in_progress`, the current state for
  "the developer is working and may ask for a reassessment", and writes one
  `ticket_updated` activity row per ticket recording the change;
- rewrites `retest_runs.previous_ticket_status` from `fix_submitted` to
  `in_progress`, so withdrawing an old request restores a current state;
- removes `fix_submitted` from `tickets_status_check` and
  `retest_runs_previous_ticket_status_check`;
- redefines `enforce_ticket_update_permissions()`,
  `enforce_retest_request_permissions()` and `withdraw_reassessment()` without
  it. A request with no recorded previous state now restores `in_progress`
  instead of `fix_submitted`;
- recreates the `risk_conversation_entries_insert` policy so clients can no
  longer record new `fix_submitted` events.

Conversation entries of kind `fix_submitted` are kept, and the kind stays legal,
because they are the audit trail of what happened, as are `activity_log` rows
whose free-text action is `fix_submitted`. The frontend keeps labels for both.

Migration `0033_dashboard_metrics_without_fix_submitted.sql` then drops the
always-zero `fix_submitted` key from `dashboard_metrics()`'s `ticketCounts`.
`create or replace` keeps its `0014`/`0015` grants. No page reads that key, so
`0033` and the frontend may deploy in either order.

**Rollout order.** Apply `0032` to every supported database before deploying
the frontend that removed its older-schema fallbacks and `fix_submitted` ticket
handling. That frontend cannot edit, withdraw or reassess a ticket still in
`fix_submitted`, and it no longer falls back when `0025`, `0027` or `0030` is
missing. A frontend that predates the removal works unchanged against `0032`.
The status rewrite is not reversible from the activity rows alone; roll forward
if it needs correcting.

### Reassessment queue (0030)

Migration `0030_reassessment_queue.sql` lets several reassessment requests be
outstanding for one risk. It adds `retest_runs.submission_id`, drops
`retest_runs_one_active_per_conversation`, and replaces it with
`retest_runs_one_running_per_conversation` (at most one running request per
risk) and `retest_runs_submission_identity` (one request per
conversation + requester + submission). `request_reassessment_entry()` creates
the request and its conversation event in one call and returns the existing pair
when a submission is retried. `start_reassessment()` now refuses a start while
another request for the risk is running and refuses to skip an older queued
request, so the queue runs oldest-first.
`reconcile_reassessment_ticket_state()` derives the remediation's state from its
outstanding requests, and `withdraw_reassessment()` restores the ticket only
when nothing else is outstanding.

**Rollout order.** Apply `0030`, then deploy the backend worker, then the
frontend:

1. **Database first.** Until `0030` is applied, a second request is rejected by
   the old unique index.
2. **Worker second.** An older worker sets the ticket to `under_review` as soon
   as any run completes. With several requests outstanding that is wrong, so the
   worker must be updated before multiple queued requests are encouraged.
3. **Frontend last.** The current frontend calls the RPC directly and has no
   pre-0030 path, so a request fails until `0030` is applied.

**Rollback is not symmetric.** Re-creating the old
`retest_runs_one_active_per_conversation` index fails while more than one
queued-or-running row exists for a conversation. Rolling the application back
alone does **not** restore the old constraint; the outstanding rows must be
resolved or cancelled explicitly first. Plan a forward correction rather than a
schema rollback.

### Reassessment eligibility (0029)

Migration `0029_reassessment_without_completion.sql` replaces
`enforce_retest_request_permissions()` so a reassessment request no longer
requires a progress row for the selected approach, at least one step, or every
step completed. Role and application access, the remediation ticket's type and
allowed states (including the historical `fix_submitted`), ticket/conversation
consistency, the required approach selection, the security-role exception,
active-request uniqueness and previous-status bookkeeping all stay as they were.
It rewrites no stored completion rows and no historical requests, and
`create or replace` keeps the function identity, so its privileges and trigger
binding are untouched.

**Deploy `0029` before the frontend that offers a reassessment with incomplete
progress.** Against a database still on `0028` or earlier, the older trigger
refuses such a request with "complete every step of the selected remediation
approach first" — the request fails cleanly and nothing is written. The
dashboard surfaces that refusal rather than working around it; there is
deliberately no fallback that marks steps complete to satisfy an older schema.
Rolling the migration back restores the completion requirement and makes those
requests fail again.

### Permission correction (0028)

Migration `0028_workflow_function_grants.sql` removes direct `anon` execution
of workflow functions and limits worker claim/recovery functions to
`service_role`. It conditionally corrects the functions present on a degraded
older schema rather than requiring optional RPCs to exist. It is an
authorization correction with no row rewrite. Deploy it after all earlier
migrations intended for that environment. If an earlier skipped migration is
introduced later, apply the grant correction again in a new tracked migration.
Rolling application code back does not restore the unsafe grants, while rolling
the migration back would require explicitly re-granting them and is not
supported.
