// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardSyncStatus, RunSyncStatus } from "@/api/automation-types";
import { automationKeys } from "@/hooks/query-keys";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let nextStatus: DashboardSyncStatus | "missing" = "completed";
const fetched: string[] = [];

vi.mock("@/api/automation-services", () => ({
  syncApi: {
    getRunSyncStatus: async (runId: string) => {
      fetched.push(runId);
      if (nextStatus === "missing") throw new Error("no sync record for this run");
      return sync(nextStatus);
    },
  },
  assessmentApi: {},
  automationApi: {},
  configApi: {},
  defaultConfigPath: () => "configs/ios.yaml",
  playbookApi: {},
  reportApi: {},
}));

function sync(status: DashboardSyncStatus): RunSyncStatus {
  return {
    run_id: "run-1",
    run_timestamp: "2026-01-01_00-00-00",
    status,
    attempt: 1,
    queued_at: "2026-01-01T00:00:00+08:00",
    started_at: null,
    completed_at: null,
    last_updated_at: "2026-01-01T00:00:00+08:00",
    error: null,
    retryable: false,
    counts: { applications: 1, assessments: 1, findings: 1, history: 0, activity: 0 },
  } as RunSyncStatus;
}

const { useRunSyncStatus } = await import("@/hooks/queries/automation");

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let invalidated: string[];

function Probe({ runId, enabled }: { runId: string | undefined; enabled?: boolean }) {
  useRunSyncStatus(runId, { enabled });
  return null;
}

async function render(runId: string | undefined, enabled?: boolean) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe runId={runId} enabled={enabled} />
      </QueryClientProvider>,
    );
  });
  // The fetch resolves after the first commit; let it land and re-render before asserting.
  for (let pass = 0; pass < 3; pass += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  fetched.length = 0;
  nextStatus = "completed";
  invalidated = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.invalidateQueries = (async (filters?: { queryKey?: unknown }) => {
    invalidated.push(JSON.stringify(filters?.queryKey));
  }) as typeof client.invalidateQueries;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("watching a run's dashboard sync", () => {
  it("invalidates on a sync that is already completed the first time it is read", async () => {
    await render("run-1");

    expect(fetched).toEqual(["run-1"]);
    expect(invalidated.length).toBeGreaterThan(0);
  });

  it("does not invalidate again while the status stays completed", async () => {
    await render("run-1");
    const first = invalidated.length;
    await render("run-1");

    expect(invalidated.length).toBe(first);
  });

  it("invalidates again for a different run that is also already completed", async () => {
    await render("run-1");
    const first = invalidated.length;

    await render("run-2");

    expect(fetched).toEqual(["run-1", "run-2"]);
    expect(invalidated.length).toBeGreaterThan(first);
  });

  it("invalidates for a new run whose completed status was already cached", async () => {
    await render("run-1");
    const first = invalidated.length;
    expect(first).toBeGreaterThan(0);

    // No undefined in between: the second run's status is served straight from the cache.
    client.setQueryData(automationKeys.runSyncStatus("run-2"), sync("completed"));
    await render("run-2");

    expect(invalidated.length).toBeGreaterThan(first);
  });

  it("says nothing for a sync that has not completed", async () => {
    nextStatus = "running";
    await render("run-1");

    expect(invalidated).toEqual([]);
  });

  it("says nothing when the backend keeps no record at all", async () => {
    nextStatus = "missing";
    await render("run-1");

    expect(invalidated).toEqual([]);
  });

  it("fetches nothing without a run", async () => {
    await render(undefined);

    expect(fetched).toEqual([]);
    expect(invalidated).toEqual([]);
  });

  it("fetches nothing at all while it is disabled", async () => {
    await render("run-1", false);

    expect(fetched).toEqual([]);
    expect(invalidated).toEqual([]);
  });

  it("spends none of the attempt budget while disabled, then starts fresh", async () => {
    nextStatus = "missing";
    await render("run-1", false);

    const disabled = client.getQueryState(automationKeys.runSyncStatus("run-1"));
    expect(disabled?.dataUpdateCount ?? 0).toBe(0);
    expect(disabled?.errorUpdateCount ?? 0).toBe(0);

    await render("run-1", true);
    expect(fetched).toEqual(["run-1"]);
  });

  it("watches as normal when no option is passed", async () => {
    await render("run-1", undefined);

    expect(fetched).toEqual(["run-1"]);
    expect(invalidated.length).toBeGreaterThan(0);
  });
});
