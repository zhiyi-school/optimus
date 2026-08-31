import { describe, expect, it } from "vitest";
import type { DashboardSyncStatus, RunSyncStatus } from "@/api/automation-types";
import {
  SYNC_STATUS_POLL_INTERVAL_MS,
  canRetrySync,
  dashboardSyncPresentation,
  isSyncPending,
  syncCountsSummary,
  syncPollInterval,
} from "./dashboard-sync";

function status(overrides: Partial<RunSyncStatus> = {}): RunSyncStatus {
  return {
    run_id: "2026-01-01_00-00-00",
    run_timestamp: "2026-01-01_00-00-00",
    status: "completed",
    attempt: 1,
    queued_at: "2026-01-01T00:00:00+08:00",
    started_at: "2026-01-01T00:00:01+08:00",
    completed_at: "2026-01-01T00:00:02+08:00",
    last_updated_at: "2026-01-01T00:00:02+08:00",
    error: null,
    retryable: false,
    counts: { applications: 1, assessments: 1, findings: 2, history: 1, activity: 1 },
    ...overrides,
  };
}

describe("polling", () => {
  it("keeps polling only while the sync is still moving", () => {
    expect(syncPollInterval("queued")).toBe(SYNC_STATUS_POLL_INTERVAL_MS);
    expect(syncPollInterval("running")).toBe(SYNC_STATUS_POLL_INTERVAL_MS);
  });

  it("stops once the sync reaches any terminal state", () => {
    for (const terminal of ["completed", "failed", "not_required"] as DashboardSyncStatus[]) {
      expect(syncPollInterval(terminal), terminal).toBe(false);
    }
  });

  it("does not poll when the backend keeps no status record", () => {
    expect(syncPollInterval(undefined)).toBe(false);
    expect(isSyncPending(undefined)).toBe(false);
  });

  it("polls no faster than a few seconds so a run does not hammer the host", () => {
    expect(SYNC_STATUS_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(2000);
  });
});

describe("presentation", () => {
  it("names every state the way the dashboard reports it", () => {
    expect(dashboardSyncPresentation("queued").label).toBe("Dashboard sync queued");
    expect(dashboardSyncPresentation("running").label).toBe("Dashboard sync in progress");
    expect(dashboardSyncPresentation("completed").label).toBe("Dashboard updated");
    expect(dashboardSyncPresentation("failed").label).toBe("Dashboard sync failed");
    expect(dashboardSyncPresentation("not_required").label).toBe("Dashboard sync not required");
  });

  it("keeps a failed sync from reading as a failed run", () => {
    expect(dashboardSyncPresentation("failed").detail).toContain("run itself is intact");
    expect(dashboardSyncPresentation("failed").tone).toBe("danger");
  });

  it("summarises what a completed sync wrote", () => {
    expect(syncCountsSummary(status())).toBe(
      "2 findings, 1 status change, 1 activity entry recorded.",
    );
  });

  it("says nothing about counts until the sync has completed", () => {
    expect(syncCountsSummary(status({ status: "running" }))).toBeNull();
    expect(syncCountsSummary(null)).toBeNull();
  });

  it("says nothing when a completed sync had no rows to write", () => {
    const empty = { applications: 0, assessments: 0, findings: 0, history: 0, activity: 0 };
    expect(syncCountsSummary(status({ counts: empty }))).toBeNull();
  });
});

describe("retry", () => {
  it("offers a retry only for a failure the worker can actually redo", () => {
    expect(canRetrySync(status({ status: "failed", retryable: true }))).toBe(true);
    expect(canRetrySync(status({ status: "failed", retryable: false }))).toBe(false);
  });

  it("never offers a retry for a state that is not a failure", () => {
    expect(canRetrySync(status({ status: "completed", retryable: true }))).toBe(false);
    expect(canRetrySync(status({ status: "running", retryable: true }))).toBe(false);
    expect(canRetrySync(status({ status: "not_required", retryable: true }))).toBe(false);
    expect(canRetrySync(null)).toBe(false);
  });
});
