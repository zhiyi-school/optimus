import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunRecord } from "@/api/automation-types";

const startRun = vi.fn();
const getRun = vi.fn();

vi.mock("@/api/automation-services", () => ({
  assessmentApi: {
    startRun: (...args: unknown[]) => startRun(...args),
    getRun: (...args: unknown[]) => getRun(...args),
  },
  defaultConfigPath: () => "configs/ios.yaml",
}));

const { findActiveRun, findPlatformRun, riskProgressInRun, runAndWait } =
  await import("./runs");

function record(status: RunRecord["status"], error: string | null = null): RunRecord {
  return {
    run_id: "2026-01-01_00-00-00",
    run_timestamp: "2026-01-01_00-00-00",
    platform: "ios",
    status,
    error,
  } as RunRecord;
}

const payload = { platform: "ios", config_path: "configs/ios.yaml", apps: "example_app" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("runAndWait", () => {
  it("reports a completed backend run with dashboard sync still pending", async () => {
    startRun.mockResolvedValue(record("completed"));

    const result = await runAndWait(payload);

    expect(result.outcome).toBe("completed");
    expect(result.dashboardSyncPending).toBe(true);
  });

  it("reports a terminal backend failure", async () => {
    startRun.mockResolvedValue(record("failed", "device fell off the bus"));

    const result = await runAndWait(payload);

    expect(result.outcome).toBe("failed");
    expect(result.dashboardSyncPending).toBe(false);
  });

  it("reports stop-waiting without claiming the run ended", async () => {
    startRun.mockResolvedValue(record("running"));
    const cancelToken = { cancelled: true };

    const result = await runAndWait(payload, undefined, cancelToken);

    expect(result.outcome).toBe("cancelledWaiting");
    expect(result.run.status).toBe("running");
    expect(getRun).not.toHaveBeenCalled();
  });

  it("reports a poll timeout while the backend is still running", async () => {
    vi.useFakeTimers();
    startRun.mockResolvedValue(record("running"));
    getRun.mockResolvedValue(record("running"));

    const pending = runAndWait(payload);
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.outcome).toBe("timedOutWaiting");
    expect(result.run.status).toBe("running");
  });
});

describe("findActiveRun", () => {
  function inFlight(overrides: Partial<RunRecord>): RunRecord {
    return {
      run_id: "2026-01-01_00-00-00",
      run_timestamp: "2026-01-01_00-00-00",
      platform: "ios",
      status: "running",
      started_at: "2026-01-01T00:00:00+08:00",
      apps: "example_app",
      risks: "ios-feature-01-risk-01",
      error: null,
      ...overrides,
    } as RunRecord;
  }

  const filter = {
    platform: "ios",
    appExternalId: "example_app",
    riskId: "ios-feature-01-risk-01",
  } as const;

  it("finds the run a remounted page should pick back up", () => {
    const run = inFlight({});
    expect(findActiveRun([run], filter)).toBe(run);
  });

  it("ignores runs that already finished", () => {
    expect(findActiveRun([inFlight({ status: "completed" })], filter)).toBeUndefined();
    expect(findActiveRun([inFlight({ status: "failed" })], filter)).toBeUndefined();
  });

  it("ignores a run for another app, risk, or platform", () => {
    expect(findActiveRun([inFlight({ apps: "other_app" })], filter)).toBeUndefined();
    expect(findActiveRun([inFlight({ risks: "ios-feature-04-risk-01" })], filter)).toBeUndefined();
    expect(findActiveRun([inFlight({ platform: "android" })], filter)).toBeUndefined();
  });

  it("treats a null selection as covering every app and risk", () => {
    const run = inFlight({ apps: null, risks: null });
    expect(findActiveRun([run], filter)).toBe(run);
  });

  it("matches a run started for many risks at once", () => {
    const run = inFlight({ risks: "ios-feature-04-risk-01,ios-feature-01-risk-01" });
    expect(findActiveRun([run], filter)).toBe(run);
  });

  it("matches an app selector the way the backend normalizes it", () => {
    const run = inFlight({ apps: "Example App" });
    expect(findActiveRun([run], filter)).toBe(run);
  });

  it("omits the risk filter when the caller watches the whole app", () => {
    const run = inFlight({ risks: "ios-feature-04-risk-01" });
    expect(findActiveRun([run], { platform: "ios", appExternalId: "example_app" })).toBe(run);
  });

  it("returns nothing until the page knows its app and platform", () => {
    expect(findActiveRun([inFlight({})], { platform: undefined, appExternalId: "example_app" })).toBeUndefined();
    expect(findActiveRun([inFlight({})], { platform: "ios", appExternalId: undefined })).toBeUndefined();
    expect(findActiveRun(undefined, filter)).toBeUndefined();
  });

  it("prefers the most recently started run", () => {
    const older = inFlight({ run_id: "old", started_at: "2026-01-01T00:00:00+08:00" });
    const newer = inFlight({ run_id: "new", started_at: "2026-01-02T00:00:00+08:00" });
    expect(findActiveRun([older, newer], filter)).toBe(newer);
  });
});

describe("riskProgressInRun", () => {
  const run = {
    run_id: "2026-01-01_00-00-00",
    platform: "ios",
    status: "running",
    risks: "risk-a,risk-b,risk-c",
    apps: "example_app",
  } as RunRecord;

  const started = (risk: string) => ({ type: "risk_started", app_id: "example_app", risk_id: risk });
  const completed = (risk: string) => ({
    type: "risk_completed",
    app_id: "example_app",
    risk_id: risk,
  });

  it("reports only the risk the device is actually on as running", () => {
    const events = [started("risk-a"), completed("risk-a"), started("risk-b")];

    expect(riskProgressInRun(events, run, "example_app", "risk-b")?.phase).toBe("running");
    expect(riskProgressInRun(events, run, "example_app", "risk-c")?.phase).toBe("queued");
  });

  it("reports a risk the run already finished as done, not running", () => {
    const events = [started("risk-a"), completed("risk-a"), started("risk-b")];

    expect(riskProgressInRun(events, run, "example_app", "risk-a")?.phase).toBe("done");
  });

  it("treats every risk as queued before the first event arrives", () => {
    expect(riskProgressInRun([], run, "example_app", "risk-a")?.phase).toBe("queued");
    expect(riskProgressInRun(undefined, run, "example_app", "risk-a")?.phase).toBe("queued");
  });

  it("does not confuse the same risk on a different app", () => {
    const events = [{ type: "risk_started", app_id: "other_app", risk_id: "risk-a" }];

    expect(riskProgressInRun(events, run, "example_app", "risk-a")?.phase).toBe("queued");
  });

  it("counts how far through the run the device is", () => {
    const events = [started("risk-a"), completed("risk-a"), started("risk-b"), completed("risk-b")];

    expect(riskProgressInRun(events, run, "example_app", "risk-c")).toMatchObject({
      phase: "queued",
      completed: 2,
      total: 3,
    });
  });

  it("has nothing to report without a run", () => {
    expect(riskProgressInRun([], undefined, "example_app", "risk-a")).toBeUndefined();
  });
});

describe("findPlatformRun", () => {
  const busy = { run_id: "r1", platform: "ios", status: "running", apps: "other_app" } as RunRecord;

  it("sees a run on the platform even when it is for another app", () => {
    expect(findPlatformRun([busy], "ios")).toBe(busy);
  });

  it("ignores the other platform's device", () => {
    expect(findPlatformRun([busy], "android")).toBeUndefined();
  });

  it("ignores finished runs", () => {
    expect(findPlatformRun([{ ...busy, status: "completed" }], "ios")).toBeUndefined();
  });
});

describe("giving up locally versus the backend failing", () => {
  it("does not claim a dashboard sync is pending when only this browser stopped waiting", async () => {
    vi.useFakeTimers();
    startRun.mockResolvedValue(record("running"));
    getRun.mockResolvedValue(record("running"));

    const pending = runAndWait(payload);
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.outcome).toBe("timedOutWaiting");
    expect(result.dashboardSyncPending).toBe(false);
    expect(result.run.status).toBe("running");
  });

  it("does not claim a dashboard sync is pending when the watcher was cancelled", async () => {
    vi.useFakeTimers();
    startRun.mockResolvedValue(record("running"));
    getRun.mockResolvedValue(record("running"));
    const cancelToken = { cancelled: true };

    const result = await runAndWait(payload, undefined, cancelToken);

    expect(result.outcome).toBe("cancelledWaiting");
    expect(result.dashboardSyncPending).toBe(false);
  });

  it("expects a dashboard sync only after the backend actually completed the run", async () => {
    startRun.mockResolvedValue(record("completed"));

    const result = await runAndWait(payload);

    expect(result.outcome).toBe("completed");
    expect(result.dashboardSyncPending).toBe(true);
  });
});
