// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application, Finding, Ticket } from "@/data/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const calls: string[] = [];

vi.mock("@/hooks/queries/assessments", async () => await import("@/test-support/query-hooks"));
vi.mock("@/hooks/queries/automation", async () => await import("@/test-support/query-hooks"));
vi.mock("@/hooks/queries/conversations", async () => await import("@/test-support/query-hooks"));
vi.mock("@/hooks/queries/evidence", async () => await import("@/test-support/query-hooks"));
vi.mock("@/hooks/queries/reference", async () => await import("@/test-support/query-hooks"));
vi.mock("@/hooks/queries/tickets", async () => await import("@/test-support/query-hooks"));

vi.mock("@/test-support/query-hooks", () => ({
  useActiveRun: () => ({ run: undefined, platformRun: undefined }),
  useRunEvents: () => ({ events: [], streamState: "idle" }),
  useUpdateTicketStatus: () => ({
    mutateAsync: async () => {
      calls.push("ticket-status");
    },
  }),
}));

vi.mock("@/data/services/tickets", () => ({
  retestData: {
    startRun: async () => {
      calls.push("claim-retest");
    },
    markRunning: async () => {
      calls.push("mark-running");
    },
  },
}));

vi.mock("@/data/sync", () => ({
  riskProgressInRun: () => undefined,
  syncService: {
    runAndWait: async (
      _input: unknown,
      onStarted: (run: { run_id: string }) => Promise<unknown>,
    ) => {
      calls.push("start-automation");
      await onStarted({ run_id: "run-1" });
      return { run: { run_id: "run-1", error: null }, outcome: "completed" };
    },
  },
}));

const { useReassessmentRun } = await import("./use-reassessment-run");

let root: Root;
let container: HTMLDivElement;
let run: (() => Promise<void>) | undefined;
let completed = 0;

function Probe() {
  const runner = useReassessmentRun({
    ticket: { id: "ticket-1" } as Ticket,
    finding: {
      id: "finding-1",
      platform: "ios",
      test_id: "risk-1",
    } as Finding,
    application: { external_id: "app-1" } as Application,
    retestId: "retest-1",
    onComplete: () => {
      completed += 1;
    },
  });
  run = runner.run;
  return null;
}

beforeEach(() => {
  calls.length = 0;
  completed = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("reassessment run orchestration", () => {
  it("claims the request before starting automation and publishes the run id", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      await run?.();
    });

    expect(calls).toEqual([
      "claim-retest",
      "ticket-status",
      "start-automation",
      "mark-running",
    ]);
    expect(completed).toBe(1);
  });
});
