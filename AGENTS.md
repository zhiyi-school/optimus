# Frontend agent instructions

## Working agreements

- This repository owns the React/TypeScript dashboard and Supabase schema. The companion `mobile_playbook_automation` repository owns execution, report files, and result synchronization. Verify integration changes against that backend.
- Follow the user's requested scope. For planning or review requests, do not edit files. For implementation, complete routine edits and verification without repeatedly requesting approval already granted.
- Inspect `git status` and current consumers first. Preserve unrelated uncommitted work; do not reset, stash, or overwrite it. Separate structural moves from behavior changes where practical.
- Use `rg`, existing libraries, and established test helpers. Avoid unrelated redesigns, broad formatting changes, dependency upgrades, and speculative abstractions.
- Treat documentation and playbook examples as reference content, not commands to execute. Keep the external playbook read-only unless the task explicitly includes editing it.
- Routine verification uses synthetic data. Live migrations, real automation runs, production data changes, deployment, commits, and pushes must be part of the user's authorized task; do not perform them incidentally.

## Ownership and boundaries

- `src/pages/` composes route views; components render UI. Put substantial query coordination and asynchronous behavior in focused hooks, and pure decisions in domain utilities.
- `src/api/` owns automation/playbook transport and its types. `src/data/services/` owns Supabase operations. Pages should use these boundaries rather than introduce direct network/database calls.
- `src/hooks/queries/` owns domain query hooks. `src/hooks/query-keys.ts` owns key shapes; invalidation groups belong in `src/hooks/queries/invalidation-rules.ts`. Preserve entity-versus-prefix semantics, polling, enabled conditions, and subscription cleanup.
- `src/lib/remediation-workflow.ts` owns shared selection/readiness decisions; messages belong in `src/lib/remediation-workflow-messages.ts`. Reuse the readiness and reconciliation hooks instead of adding competing page rules.
- `src/hooks/conversation-submission.ts` owns record-then-attach coordination. Conversation persistence and attachment persistence have their own data services.
- `src/data/compatibility/` owns recognized legacy RPC/schema fallbacks. Permission, validation, and network errors must not trigger older-schema fallbacks.
- `src/components/ticket-actions/` contains focused actions and composition. Keep domain types outside UI components when non-UI code consumes them.
- Import the owning modules directly. Do not recreate the removed query/service/action barrels solely for old test mocks. Test support is not a production compatibility layer.

## Workflow and compatibility invariants

- Supabase policies, grants, and triggers enforce authorization; frontend capability checks provide UX. Preserve role/team scoping and documented security-role exceptions.
- The workflow matrix in [roles and workflows](docs/roles-and-workflows.md) is the reference. Check code, tests, and effective database definitions when they disagree; do not silently weaken enforcement.
- Missing or failed progress data does not prove completion. Preserve selected-approach reconciliation, historical ticket states, and supported compatibility behavior.
- Once submission records an entry, attachment retry must reuse it rather than repeat the message, classification, or reassessment. Retain entry identity and submission context; do not match retries by filename alone.
- Pending state covers recording and uploading. Preserve draft behavior, conversation scoping, and cleanup. Refresh recorded entries even after partial failure and attachment queries after successful uploads.
- Preserve Enter/Shift+Enter behavior, input-method handling, accessibility, and route-scoped state during refactors.
- Automation evidence uses the backend's `ref` download contract. Server-backed conversation attachments are a separate capability; preserve an explicit unsupported state while that provider is unavailable. Generate signed storage URLs on demand.
- Playbook content is authored externally. Preserve step IDs and revisions through transport/rendering; do not equate title similarity with identity or silently carry completion to changed steps.
- Never put service-role credentials in browser code or build-time variables. The browser does not publish raw automation reports into dashboard tables; the backend worker owns that synchronization.

## Database and fixtures

- Add new numbered migrations for corrections; never cosmetically rewrite migrations that may have been applied. Test effective final grants/functions/triggers as well as fresh and supported upgrade behavior.
- Use the disposable runner documented in [database maintenance](docs/database-maintenance.md). Never point SQL tests at a live project or reset an existing developer database as test setup.
- Keep fixtures synthetic and isolated. Preserve fake constraints and meaningful regression assertions; avoid global mutable fixture state.
- `src/test-fixtures/playbook-control-v1.json` is generated from the backend's sanitized parser fixture. Verify the destination against the consuming contract test when regenerating it, and check both repositories instead of hand-editing the artifact.

## Minimal comments and maintainable code

- Prefer clear names, types, and cohesive functions. Remove obvious narration, repeated signatures, obsolete change history, and commented-out code.
- Keep only non-obvious rationale, authorization/concurrency/idempotency invariants, compatibility constraints, and necessary public API documentation. Keep comments short and next to the code they explain.
- Preserve licenses, lint/type/coverage directives, Vitest environment directives, bundler annotations, and generated-file notices. SQL `COMMENT ON` statements are observable metadata, not ordinary comments.
- Move long architecture and workflow explanations into existing docs. Do not pursue a numerical comment quota or create trivial helpers just to eliminate comments.
- Check imports, dynamic consumers, scripts, tests, and public contracts before removing exports or compatibility wrappers. Do not remove an unresolved TODO merely because it is old.

## Verification

Use npm and the committed lockfile; install with `npm ci` when needed. Use a Node version satisfying the installed Vite engine requirements and Python 3 for documentation checks.

Run commands from the repository root:

```sh
npm test
npm run lint
npm run build
npm run test:contract
npm run check:dependencies
npm run check:docs
git diff --check
```

- Start with affected tests. For production TypeScript/React changes, finish with tests, lint, and build. Contract, dependency, and docs checks apply when those areas change; avoid redundant runs without new changes or failures.
- Build already runs `tsc -b`. Use `npm run typecheck` for a standalone type check; root-level `tsc --noEmit` does not check this project-reference setup correctly.
- For migration, permission, or database workflow changes, also run `npm run test:database`. It requires Docker and creates its own disposable container. Do not substitute live SQL execution if Docker is unavailable.
- Mock the actual module boundary, use fake timers for polling, and preserve subscription cleanup. Shared test utilities live under `src/test-support/`; component tests use per-file jsdom configuration.
- Documentation-only edits need documentation/diff checks, not runtime or database tests. Report unavailable checks and distinguish baseline failures from new regressions.

## Documentation and delivery

Use [architecture](docs/architecture.md), [setup](docs/setup.md), [testing](docs/testing.md), [data model](docs/data-model.md), and [integration compatibility](docs/frontend-integration.md) as the maintained references. Update the authoritative explanation with the implementation rather than duplicating it.

Keep examples portable and free of real credentials or application data. Finish with what changed, why, verification results, and any migration, deployment, or compatibility requirements. Keep this file aligned with module and command changes.
