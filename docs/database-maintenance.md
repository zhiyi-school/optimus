# Database maintenance

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

The script verifies two distinct paths:

| Path | Starting point | Coverage |
| --- | --- | --- |
| Fresh installation | Empty database | `0001` through the current migration, version-appropriate SQL workflow/RLS suites, effective schema, grants, triggers, indexes, constraints, RLS and storage policies |
| Supported upgrade | Schema through `0024` | Synthetic application/team/roles, findings, conversations/events/attachments, remediation tickets including `fix_submitted`, selected controls and completed/incomplete steps, and a historical reassessment; then `0025` onward and preservation/final-schema assertions |

`0024` is the single supported historical test baseline because `0025`–`0027`
are the documented classification, reassessment, and attachment compatibility
boundary. Older versions are not claimed as tested upgrade origins. The fresh
path still proves the entire ordered chain from `0001`.

Migration files perform durable schema changes. SQL files in `supabase/tests/`
are assertions with their own fixtures and final `rollback`; the runner invokes
them only after the schema version their fixtures require. A second tracked
migration pass must apply nothing. Generated IDs, timestamps, and formatted SQL
are deliberately not compared.

## Adding a migration

1. Add the next numbered file; never rewrite a migration that may have been
   applied.
2. Make legacy-value handling and backfills explicit. Add an upgrade fixture
   assertion when existing rows can be affected.
3. Test the effective final function, trigger, grant, and policy definitions,
   not only the statements in the new file. PostgreSQL/Supabase default grants
   may grant roles directly, so `revoke ... from public` is not always enough.
4. Add or extend an SQL role/workflow test with explicit expected failures.
5. Run `npm run test:database`, the frontend tests, lint, and build.

The repository's SQL-file runner is ordered and tracked, but it is not a
universal rollback system. Files may contain multiple autocommitted statements,
backfills, and irreversible data changes. Production rollback therefore means
a reviewed forward correction or a tested restore plan, not assuming every
migration can be run backward.

## Reassessment queue (0030)

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
   the old unique index and the frontend falls back to the pre-0030 path, which
   reuses the existing active request.
2. **Worker second.** An older worker sets the ticket to `under_review` as soon
   as any run completes. With several requests outstanding that is wrong, so the
   worker must be updated before multiple queued requests are encouraged.
3. **Frontend last.** It only starts creating distinct requests once the RPC is
   present; without it, `requestReassessmentWithCompatibility` returns null and
   the legacy single-request path is used unchanged.

**Rollback is not symmetric.** Re-creating the old
`retest_runs_one_active_per_conversation` index fails while more than one
queued-or-running row exists for a conversation. Rolling the application back
alone does **not** restore the old constraint; the outstanding rows must be
resolved or cancelled explicitly first. Plan a forward correction rather than a
schema rollback.

## Reassessment eligibility (0029)

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

## Current permission correction

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
