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
