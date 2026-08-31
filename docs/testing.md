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

## What is not covered

There is **no component rendering test infrastructure** — no jsdom, no
Testing Library. Component behaviour is verified by typechecking, linting, the
build, and by extracting logic into testable functions.

The consequence is real: two UI state bugs in this codebase (state leaking
between test pages, and a queued risk reported as running) were invisible to
the existing suite and were caught only by using the app. `TestDetail.test.tsx`
guards the first of those without a DOM by calling the component function and
inspecting the returned element's `key`.

Adding jsdom and `@testing-library/react` would close this gap for roughly one
devDependency. That is a deliberate open decision, not an oversight.

## Backend tests

The automation backend has its own suite — `python -m pytest -q` in that
repository, needing no device, network or Supabase project. See its
`docs/testing.md`.
