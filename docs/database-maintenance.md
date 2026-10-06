# Database maintenance

## Layout

| Folder | Purpose | Applied to |
| --- | --- | --- |
| `supabase/migrations/` | Fresh-install baseline: the final schema, built directly | New projects only |
| `supabase/fixes/` | Numbered forward corrections for live projects, each already carried by the baseline | Live projects; harmless on new projects |
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

**New project:** run every file in `supabase/migrations/` in order. The
baseline already contains every fix, so no file in `supabase/fixes/` is needed;
each is written to be a no-op there if it is run anyway. **Live project:** run
only the files in `supabase/fixes/` it has not applied yet; never run the
baseline against it.
`npx supabase db push` reads only `supabase/migrations/`, so apply fixes with
the SQL Editor or `psql`.

## Disposable verification

Run the complete database contract only with:

```sh
npm run test:database
```

This same maintained command runs in the CI database job. Locally and in CI it
requires Docker and a PostgreSQL 15 image, `postgres:15-alpine` by default or
the image named by `DATABASE_TEST_IMAGE`; it never uses a linked Supabase
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
| Baseline alone | Empty database | The baseline with no fix, the current SQL suites and the final-schema assertions; its schema must match the fresh installation's, proving a new project needs no fix |
| Legacy chain | Empty database | Every file in `legacy-migrations/`, with the version-specific suites in `supabase/tests/legacy/` and each top-level `supabase/tests/NNNN_*` suite run at the version their fixtures need, then every fix, the current suites and the final-schema assertions |
| Supported upgrade | Schema through `0024` | Synthetic application/team/roles, findings, conversations/events/attachments, remediation tickets including `fix_submitted`, selected controls and completed/incomplete steps, and a historical reassessment; then `0025` onward, every fix, the `0032` move of `fix_submitted` to `in_progress`, and preservation/final-schema assertions |
| Schema equivalence | Fresh and legacy results | `pg_dump --schema-only` of both must match once the archived objects are dropped from the legacy copy |
| Degraded grant compatibility | Bootstrap only | Legacy `0028` applied to a database that has none of the workflow RPCs, proving its grant corrections skip functions that are absent |

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
   rewrite a fix that may have been applied. Write it so that it changes
   nothing on a database that already has its result (`add column if not
   exists`, `create or replace`, guarded backfills), because a new project's
   baseline already carries it.
2. Make the same change in the affected baseline file in
   `supabase/migrations/`, as a final definition rather than an extra
   statement: a new column goes at the end of its `create table`, after the
   existing columns, so its position matches a live project that added it.
3. Make legacy-value handling and backfills explicit. Add an upgrade fixture
   assertion when existing rows can be affected.
4. Test the effective final function, trigger, grant, and policy definitions,
   not only the statements in the new file. PostgreSQL/Supabase default grants
   may grant roles directly, so `revoke ... from public` is not always enough.
5. Add or extend an SQL role/workflow test in `supabase/tests/` with explicit
   expected failures, and a matching check in
   `supabase/test-support/final_schema_assert.sql`. If the fix changes
   behaviour an existing test asserts, update that test.
6. Run `npm run test:database`, the frontend tests, lint, and build. The
   equivalence check fails when the baseline and the legacy chain plus fixes
   disagree, and the baseline-alone check fails when a fix is missing from the
   baseline.

The repository's SQL-file runner is ordered and tracked, but it is not a
universal rollback system. Files may contain multiple autocommitted statements,
backfills, and irreversible data changes. Production rollback therefore means
a reviewed forward correction or a tested restore plan, not assuming every
fix can be run backward.

## Re-baselining

Retire fixes from `supabase/fixes/` only when every live project has applied
them. The baseline already carries them, so retiring changes no schema.

1. Move the retired files from `supabase/fixes/` to
   `supabase/legacy-migrations/`, keeping their numbers. Leave
   `supabase/fixes/.gitkeep` in place so the folder survives being emptied.
2. Move tests that no longer hold against the final schema to
   `supabase/tests/legacy/`.
3. Run `npm run test:database`; the equivalence check proves the baseline still
   matches the legacy chain.

## Current fixes

The notes below describe the fixes in `supabase/fixes/`.

### Application identity per platform (0043)

Fix `0043_application_identity_per_platform.sql` replaces the unique constraint
on `applications.external_id` with one on `(external_id, platform)`. An
application's automation identity is its backend app id on its platform, so
the iOS and Android builds of an app can share an app id and remain separate
applications. The dashboard sync upserts applications on both columns, so a
sync of one platform can never merge into the other platform's row. The new
constraint is looser than the old one, so existing rows always satisfy it and
none change. Rows without an `external_id` stay unconstrained. The baseline
carries the same constraint. `supabase/tests/0043_application_identity_per_platform_rls.sql`
and `final_schema_assert.sql` cover it.

**Rollout order.** Apply `0043`, after `0042`, before deploying the dashboard
sync worker that upserts on `external_id,platform`; against an older schema its
application writes are refused because no constraint matches.

### Latest run on assessments (0042)

Fix `0042_assessment_latest_run.sql` adds `assessments.latest_run_id`, the
newest automation run the dashboard sync applied to the assessment: its own
run, then any risk rerun of it. A rerun that no run request started updates the
assessment that was current when it ran instead of adding one, so an app keeps
one assessment per full run of a version. The sync compares an incoming run
with `latest_run_id` and leaves the assessment unchanged when the run is older,
so replaying an old report never overwrites newer progress or version. A
rerun leaves the assessment's `app_version` as it is. Existing
rows start null, which the sync treats as no run applied yet. No other rows
change. The baseline carries the same column.
`supabase/tests/0042_assessment_latest_run_rls.sql` and
`final_schema_assert.sql` cover it.

Assessments that earlier reruns already created are left as they are; the
Assessments card on a test page shows the five newest and a "Show all" toggle.

**Rollout order.** Apply `0042`, after `0041`, before deploying the dashboard
sync worker that writes `latest_run_id`; against an older schema its assessment
writes are refused.

### Build versions on assessments (0041)

Fix `0041_assessment_build_versions.sql` lets an application that has already
been assessed be assessed again, of a chosen iOS build version, without
deleting it. It adds:

- `assessment_run_requests.build_version`, the iOS build version the run must
  test. The assessment worker passes it to `POST /runs`; null lets the
  automation host test the app's highest version.
- `assessments.app_version`, the version the assessment tested, which the
  dashboard sync writes from the run.
- `request_new_assessment(p_application_id, p_build_version)`, Security Team
  only. It locks the application, refuses one outside the caller's access, a
  version on Android, which tests the installed app, and an application that
  already has an assessment `queued`, `waiting` or `running`. It then creates a
  `queued` `manual::` assessment sized like the last one and its run request,
  and returns the assessment. Earlier assessments are kept; findings, tickets
  and conversations belong to the application, so they carry over.

It also redefines `request_assessment_run()` so a new request for an assessment
copies the `build_version` of that assessment's latest request, and a retry
tests the same build. `create or replace` keeps its grants; the new function is
granted to `authenticated` and `service_role` and revoked from `anon`. No rows
change. The baseline carries the same definitions.
`supabase/tests/0041_assessment_build_versions_rls.sql` and
`final_schema_assert.sql` cover it.

**Rollout order.** Apply `0041` before deploying the dashboard sync worker that
writes `app_version`: against an older schema its assessment writes are
refused. The frontend that calls `request_new_assessment` also needs `0041`;
until then its "Assess a new version" fails with the missing-function error.
The assessment worker only reads `build_version`, so it works either way.

### Test runs in conversation activity (0040)

Fix `0040_test_runs_in_conversation_activity.sql` redefines
`risk_conversation_activity()` so the Last Updated column also moves when a test
runs. A risk conversation shows two kinds of activity, and the function now
counts both:

- a stored entry, a message or a workflow event, including events the sync
  worker writes, by its `created_at`;
- a synced test run. Runs are not stored as entries: the conversation reads them
  from the automation backend. The sync worker stamps each run's result on its
  finding, so a finding with a `latest_test_run_id` contributes its
  `updated_at`, which is when that result arrived rather than when the run
  started. The backend's run ids are local times without a time zone, so they
  are not used.

The result column keeps the name `last_entry_at` that `0039` gave it. A fresh
install runs the baseline and then every fix, so `0039`'s `create or replace`
runs after the final definition; a renamed column would make it fail. Keeping
the name lets `0039` apply and `0040` restore the final body. Grants are kept.
It changes no rows. The baseline carries the same definition.
`supabase/tests/0040_test_runs_in_conversation_activity_rls.sql` and
`final_schema_assert.sql` cover it.

**Rollout order.** Apply `0040` after `0039`. The frontend needs no change for
it; until it is applied, Last Updated reflects conversation entries only.

### Conversation activity (0039)

Fix `0039_conversation_activity.sql` adds `risk_conversation_activity()`, which
returns, for each application, the time of the newest entry in any of its risk
conversations (`last_entry_at`). The Assess and Resolve lists show it as **Last
Updated**, replacing **Created At**; an application with no activity shows a
dash. It does not use `risk_conversations.updated_at`, because opening a risk
page creates or links its conversation and moves that timestamp without any
activity. `0040` extends it to synced test runs.

The function runs as the caller, so RLS limits it to the applications the caller
may see. It is granted to `authenticated` and `service_role`, not `anon`. It
changes no rows. The baseline carries the final definition, so a new project
needs no fix. `supabase/tests/0039_conversation_activity_rls.sql` and
`final_schema_assert.sql` cover it.

**Rollout order.** Apply `0039` before deploying the frontend that reads it;
without it, the activity request fails and both lists show a dash in Last
Updated.

## Legacy migrations

The notes below describe the rollout of migrations in
`supabase/legacy-migrations/`. Every live project has applied them.

### Remediation withdrawn on acceptance (0038)

Fix `0038_withdraw_remediation_on_acceptance.sql` redefines
`accept_risk_entry()` so that accepting a risk also withdraws its open
remediation ticket (`open`, `in_progress` or `rejected`, after any reassessment
cancellation has released it). The withdrawal is recorded as the accepting
developer, with the reason "Risk accepted", a `remediation_withdrawn`
conversation event and an activity-log row, through the same ticket guards as a
developer's own withdrawal. A remediation under security review is unchanged.
Without it, an accepted risk kept reading "In progress" from its remediation.

It changes no existing rows: remediations of risks accepted under `0037` stay
open until the risk is accepted again. Grants are kept by `create or replace`.
The baseline carries the same definition.
`supabase/tests/0038_withdraw_remediation_on_acceptance_rls.sql` and
`final_schema_assert.sql` cover it, and the `0037` suite asserts the final
behavior.

**Rollout order.** Apply `0038` after `0037`, before or with the frontend that
pauses remediation while a risk is accepted. The backend worker needs no change.

### Developer risk acceptance (0037)

Fix `0037_developer_risk_acceptance.sql` lets a developer accept a risk from
its conversation and retract that acceptance. It:

- adds `conversation_id`, `accepted_run_id`, `accepted_status`,
  `submission_id`, `ended_at`, `ended_by`, `end_reason` and `end_note` to
  `risk_acceptance`, the `risk_acceptance_end_fields` constraint, and unique
  indexes for one acceptance in force per finding and for submission retries;
- adds the `risk_accepted`, `risk_acceptance_retracted` and
  `risk_acceptance_ended` conversation event kinds;
- adds `accept_risk_entry()` and `retract_risk_acceptance()`, granted to
  `authenticated` and `service_role`, and the deferred trigger
  `trg_end_risk_acceptance_on_reduced_risk` on `finding_history`;
- redefines `enforce_ticket_update_permissions()` to admit the ticket
  transitions those functions make, and `enforce_retest_request_permissions()`
  to refuse a reassessment request while the risk is accepted;
- restricts the `risk_acceptance_insert` policy to `pending` rows.

It changes no rows. Existing `risk_acceptance` rows get null values in the new
columns; an existing `accepted` row with no ending counts as in force, and the
one-in-force index cannot be created if a finding already has two. The UI never
wrote such rows. The workflow is described in
[roles and workflows](./roles-and-workflows.md#risk-acceptance-workflow) and the
schema in [the data model](./data-model.md#risk-acceptance).

The baseline carries the same definitions, so a new project needs no fix.
`supabase/tests/0037_developer_risk_acceptance_rls.sql` and
`final_schema_assert.sql` cover it.

**Rollout order.** Apply `0037` to every live project before deploying the
frontend that offers Accept Risk; without it, accepting fails because the
functions do not exist. The backend worker needs no change. Its
`finding_history` inserts now also end an acceptance in force when the status
becomes Reduced Risk, in the same transaction.

### Run id on run requests (0036)

Fix `0036_assessment_run_request_run_id.sql` adds a nullable
`assessment_run_requests.run_id`. The assessment worker writes it in the same
update that marks the request `completed`, which happens as soon as the
automation host accepts the run. The dashboard reads it to follow that run with
`GET /runs/{run_id}` and then its dashboard sync with
`GET /runs/{run_id}/sync-status`, so the expanded assessment row shows testing,
then analysis and reporting. Clients still only read the queue; the column
needs no new policy or grant. Older requests keep a null `run_id`.

The baseline's `0001_extensions_and_tables.sql` defines the same column, so a
new project needs no fix. `supabase/tests/0036_assessment_run_request_run_id_rls.sql`
and `final_schema_assert.sql` cover it.

**Rollout order.** Apply `0036` to every live project before deploying the
backend worker that writes `run_id` or the frontend that reads it. Against a
database without the column, that worker's completion write is refused after
the run has started, so the request keeps its lease until it expires and is
then started again; the frontend's request read is unaffected, because it
selects every column.

### Restoring ticket guards (0035)

`0030` replaced `enforce_ticket_update_permissions()` with `create or replace`
to recognise the reassessment reconciler, and the new body left out three guards
that `0026` still had. `0032` and the baseline inherited the gap until `0035`. From `0030`
onwards a developer with access to the application could, through the REST API,
change a ticket's `type`, `finding_id`, `application_id`, `created_by`,
`assigned_user_id` or `assigned_team_id`, set `closed_at` outside a withdrawal,
and edit `withdrawn_at`, `withdrawn_by` or `withdrawal_reason` after the fact.
The dashboard never makes those writes, so nothing failed; only the legacy
`0017` and `0018` suites asserted the guards, and they run before `0030`.

Migration `0035_restore_ticket_ownership_guards.sql` redefines the function
with
the guards restored for callers holding neither `security` nor `admin`:

- withdrawal details are written only by the withdrawing update, which must
  also record `withdrawn_at`;
- only security sets or clears `closed_at`;
- the ownership fields above cannot change.

The reconciler and reassessment-withdrawal paths return before these checks and
are unaffected, as are the service-role workers. The migration changes no rows
and needs no frontend change, so it could be applied at any time. The baseline's
`0002_functions.sql` carries the same function body.
`supabase/tests/0035_restore_ticket_ownership_guards_rls.sql` and
`final_schema_assert.sql` cover it.

### Internal reassessment reconciliation (0034)

Migration `0034_reconcile_reassessment_internal_only.sql` revokes execution of
`reconcile_reassessment_ticket_state()` from `authenticated`. Only the
reassessment RPCs, which run as the owner, and `service_role` call it, so a
signed-in client can no longer rewrite or read a ticket's status through it.

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
whose free-text action is `fix_submitted`. The frontend keeps a label only for
the conversation entry (`src/domain/status-labels.ts`); it never reads
`activity_log` labels.

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

### Reassessment without a remediation (0031)

Migration `0031_reassessment_without_remediation.sql` replaces
`enforce_retest_request_permissions()` so a developer may request a reassessment
from the risk conversation alone, with no remediation ticket. A request that
names a ticket must still name a remediation ticket opened against this risk;
remediation state, a selected approach and progress are no longer conditions.
`withdraw_reassessment()` restores a ticket only when the request has one.

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
