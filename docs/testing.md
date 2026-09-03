# Testing

What the dashboard's checks cover, how to run them, and the conventions the
existing tests follow.

## Commands

```bash
npm test          # vitest, single run
npm run typecheck # tsc -b
npm run lint      # eslint
npm run build     # tsc -b, then vite build
```

`npm run build` is the strongest single check — it typechecks and then proves
the bundle actually builds.

> `npx tsc --noEmit` does **not** work here. This project uses TypeScript
> project references with `"files": []` in the root `tsconfig.json`, so that
> command silently checks nothing. Always use `tsc -b` (which is what
> `npm run typecheck` and `npm run build` run).

Watch mode while developing:

```bash
npx vitest
```

## What is covered

Tests run in Node with no DOM library, so they target pure logic and the API
layer rather than rendered components.

| Area | File |
| --- | --- |
| Run start/poll behaviour, in-flight run matching, per-risk phase | `src/data/sync/runs.test.ts` |
| Automation API client — SARIF and sync methods, error degradation, URL escaping | `src/api/automation-services.test.ts` |
| Dashboard sync presentation, polling start/stop, retry gating | `src/lib/dashboard-sync.test.ts` |
| SARIF export gating and download filename | `src/lib/sarif.test.ts` |
| Run event stream labels | `src/lib/run-stream.test.ts` |
| Metrics RPC fallback | `src/data/services/metrics.test.ts` |
| Test page keying (state must not leak between tests) | `src/pages/TestDetail.test.tsx` |
| Capability model, `/resolve` access states, post-login routing | `src/auth/permissions.test.ts` |
| Remediation progress formulas, control seeding, workflow gates | `src/lib/resolve.test.ts` |
| The whole developer lifecycle, sign-in to closure | `src/lib/resolve-workflow.test.ts` |
| Playbook block allowlist and inline-link safety | `src/lib/playbook.test.tsx` |
| Playbook API client — escaping, error degradation | `src/api/playbook-services.test.ts` |

## Conventions

**Keep logic testable by keeping it pure.** The reason polling, run matching,
sync presentation and SARIF gating are all unit-tested is that each lives in a
plain function in `src/lib/` or `src/data/sync/` rather than inside a component.
New behaviour of that kind should follow the same shape.

**Prove a new test can fail.** After writing a test for a fix, revert the fix
and confirm the test fails, then restore it. Several tests here exist because
that step caught an assertion that would have passed either way.

**Mock at the module boundary.** API tests `vi.mock("@/api/automation-client")`
and assert on the calls, so they exercise the real service code without a
network. Match the real error shape — the client's interceptor always attaches
`status`, and code paths depend on that.

**Use fake timers for anything that polls.** `vi.useFakeTimers()` plus
`vi.runAllTimersAsync()`; a poll-cap test that waits in real time takes minutes
and will be deleted by whoever hits it next.

## Database tests

Six SQL files in `supabase/tests/` check the rules the developer workflow
depends on at the table level, where they are actually enforced:

| File | What it proves |
|---|---|
| `0017_ticket_controls_rls.sql` | team scoping on control progress, a developer with no team seeing nothing, and every security-owned action refused for a developer |
| `0018_ticket_withdrawal_rls.sql` | a withdrawal must carry a reason and name its author, is refused once security verification has started, never sets `closed_at`, leaves the finding unresolved, cannot be edited afterwards, resumes only as `in_progress`, and never lets a developer reopen or close what security finalised |
| `0020_risk_conversations_rls.sql` | entries that belong to one conversation only, security-only classification and retest events, a reassessment request that still needs an eligible remediation ticket, a read-only CIO, an append-only feed, a ticket that keeps the conversation it was opened against, and legacy message tables no policy exposes |
| `0021_application_risk_conversations_rls.sql` | one conversation per application risk that cannot be moved and is reached from any of that application's assessments, a merge that carries every entry, attachment, ticket link and retest record into the oldest thread, a ticket that keeps the assessment it was raised against, access decided by the application so no other organisation is reachable, a classification function that writes all three records or none and refuses anyone but security, one reassessment in flight per risk, and an idempotent historical placement |
| `0022_selected_remediation_control_rls.sql` | one chosen remediation approach per ticket, changeable only while the developer still owns it |
| `0023_assessment_run_requests_rls.sql` | only security may queue a run and only where it has access, one active request per assessment however often it is asked for, an atomic claim two workers cannot both win, an expired lease returned to the queue, a manual retry that wakes the existing request rather than opening another, a queue no client can write to directly, and assessment transitions that refuse to restart a completed assessment |

None is part of `npm test` — they need a database. Paste one into the
Supabase SQL Editor and run it. Each creates its own placeholder fixtures,
impersonates each role by setting `request.jwt.claims`, asserts, and ends with
`rollback`, so it leaves nothing behind and is safe against a live project. A
failed assertion raises; a clean run prints `0017 RLS checks passed`,
`0018 withdrawal checks passed`, `0020 risk conversation checks passed`,
`0021 application risk conversation checks passed`, `0022 selection checks
passed` or `0023 assessment run request checks passed`.

**A migration that replaces a shared trigger has to carry forward what earlier
ones added.** `0022` rewrote `enforce_ticket_update_permissions` with
`create or replace` and silently dropped the two write-once guards `0021` had
added to it, which let a developer repoint a ticket's conversation again. The
RLS suites caught it; `0023` restores them. When a migration replaces a function
an earlier migration also touched, diff the bodies rather than assuming.

**Test the migration's own logic, not a copy of it.** `0021`'s merge and
historical placement live in `merge_duplicate_risk_conversations()` and
`place_unlinked_ticket_conversations()`, which the migration calls and the suite
calls too. An earlier version mirrored those statements inside the test file,
and mutation testing showed the mirror hid three real defects in the migration:
the copy passed while the migration was wrong.

**An `update` or `delete` that no policy allows matches no rows rather than
raising.** So `assert_refused` proves nothing about a table with no `update`
policy: run the statement and assert the row is unchanged instead. Several of
`0020`'s append-only assertions were passing for the wrong reason until that was
fixed.

**Write these assertions so they can only pass for the right reason.** An
assertion that a developer cannot withdraw a risk-acceptance ticket proves
nothing if that ticket is also in a state no ticket can be withdrawn from — the
eligibility rule refuses it and the type rule is never reached. The way to find
that out is to break one rule in the trigger at a time and confirm a *named*
assertion fails; three of these assertions were passing for the wrong reason
until that was done.

## The end-to-end test is a logic test

`src/lib/resolve-workflow.test.ts` walks a finding through the entire developer
lifecycle — sign-in routing, control initialisation, step completion, submit
fix, request reassessment, security verification, closure — asserting the gates
and the labels at each stage, and that the developer never holds the capability
for a security-owned step.

A second walkthrough covers the preview route into a tracked remediation, and a
third covers withdrawal and resume: that the finding stays unresolved, that
`closed_at` is untouched, that control progress and the withdrawal record
survive, and that closure stays with security.

They drive the pure functions rather than a browser, so they prove the workflow
*rules*, not the wiring. A broken button or a mis-wired query would still pass
them. The component tests below cover part of that gap; a real browser-driving
test would cover the rest.

## Component tests

There is no Testing Library. Components that need a DOM mount through
`react-dom/client` directly, in a file that opts into jsdom per-file:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
```

`(globalThis as ...).IS_REACT_ACT_ENVIRONMENT = true` at module scope, a fresh
container and root per test, `act(() => root.unmount())` in `afterEach`. Wrap
anything containing a `Link` in `<MemoryRouter>`. Assertions go through
`container.querySelector` and `container.textContent`.

`control-navigation.test.tsx`, `control-content.test.tsx` and `Layout.test.tsx`
cover what the pure-function tests cannot reach: that a click anywhere on a
control card actually navigates — title, summary, badge, progress bar, card
padding and the "View steps" label all reach the same route — that the route
matches the viewer's access, that no interactive element is nested inside
another, that a preview renders every step and its screenshots while offering
nothing that could record progress, that a checkbox in work mode fires the
mutation with the right arguments, and that each navbar item appears only for
the capability that owns it.

Navigation is asserted by dispatching a real bubbling click and reading the
router's location back from a probe component, not by comparing `href`
attributes — an `href` proves a link exists, not that clicking the summary
text reaches it.

## What is not covered

**The live-update poll is not exercised end to end.** `usePlaybookRevisionWatch`
polls, compares and invalidates, but no test drives a real revision change
through a mounted page — the reconciliation and rendering rules underneath it are
covered by `resolve-workflow.test.ts` and the component tests instead.

**Pages are not mounted.** The tested units are components and pure functions;
no test renders `Resolve`, `ResolveTicket`, `FindingDetail`, `ControlDetail` or
`ControlPreview` with a real query client, so a mis-wired hook, a wrong
`enabled` condition or a broken loading branch would still pass. That
`ControlPreview` records no progress is guarded instead by a check that the page
imports no progress mutation — cheap, and it fails the moment one is added. The consequence is real: two UI state
bugs in this codebase (state leaking between test pages, and a queued risk
reported as running) were invisible to the suite and were caught only by using
the app.

**Nothing drives a browser.** Navigation between routes, authentication and the
Supabase round trip are all stubbed or bypassed.

## Backend tests

The automation backend has its own suite — `python -m pytest -q` in that
repository, needing no device, network or Supabase project. See its
`docs/testing.md`.
