import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();

vi.mock("@/api/automation-client", () => ({
  automationClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    defaults: { baseURL: "http://127.0.0.1:8080" },
  },
}));

const { syncApi } = await import("./automation-services");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getRunSyncStatus", () => {
  it("asks the backend for this run's sync record", async () => {
    get.mockResolvedValue({ data: { run_id: "r1", status: "queued" } });

    await expect(syncApi.getRunSyncStatus("2026-01-01_00-00-00")).resolves.toMatchObject({
      status: "queued",
    });
    expect(get).toHaveBeenCalledWith("/runs/2026-01-01_00-00-00/sync-status");
  });

  it("treats a missing record as no status rather than an error", async () => {
    get.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));

    await expect(syncApi.getRunSyncStatus("r1")).resolves.toBeNull();
  });

  it("treats an older backend without the endpoint as no status", async () => {
    get.mockRejectedValue(Object.assign(new Error("no route"), { status: 405 }));

    await expect(syncApi.getRunSyncStatus("r1")).resolves.toBeNull();
  });

  it("still surfaces a real backend fault", async () => {
    get.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));

    await expect(syncApi.getRunSyncStatus("r1")).rejects.toThrow("boom");
  });

  it("escapes a run id so it cannot reshape the request path", async () => {
    get.mockResolvedValue({ data: {} });

    await syncApi.getRunSyncStatus("../../etc/passwd");

    expect(get).toHaveBeenCalledWith("/runs/..%2F..%2Fetc%2Fpasswd/sync-status");
  });
});

describe("getWorkerStatus", () => {
  it("reports operational state without any credential in it", async () => {
    get.mockResolvedValue({
      data: {
        enabled: true,
        worker_state: "idle",
        queue_depth: 0,
        last_success_at: "2026-01-01T00:00:00+08:00",
        last_failure_at: null,
        last_error: null,
        recovery_sweep_enabled: true,
      },
    });

    const worker = await syncApi.getWorkerStatus();

    expect(worker?.worker_state).toBe("idle");
    expect(JSON.stringify(worker)).not.toMatch(/service_role|apikey|SUPABASE/i);
  });

  it("returns null when the automation host is unreachable", async () => {
    get.mockRejectedValue(
      Object.assign(new Error("connection refused"), { status: undefined, detail: undefined }),
    );

    await expect(syncApi.getWorkerStatus()).resolves.toBeNull();
  });
});

describe("resyncRun", () => {
  it("asks the backend to queue another pass", async () => {
    post.mockResolvedValue({ data: { run_id: "r1", status: "queued" } });

    await expect(syncApi.resyncRun("r1")).resolves.toMatchObject({ status: "queued" });
    expect(post).toHaveBeenCalledWith("/runs/r1/sync");
  });

  it("sends no body, so the browser can never supply sync credentials", async () => {
    post.mockResolvedValue({ data: {} });

    await syncApi.resyncRun("r1");

    expect(post.mock.calls[0]).toHaveLength(1);
  });
});

const { assessmentApi } = await import("./automation-services");

describe("SARIF export", () => {
  it("builds a URL against the automation host, not Supabase", () => {
    expect(assessmentApi.reportSarifUrl("2026-01-01_00-00-00")).toBe(
      "http://127.0.0.1:8080/reports/2026-01-01_00-00-00/sarif",
    );
  });

  it("escapes a run timestamp so it cannot reshape the request path", () => {
    expect(assessmentApi.reportSarifUrl("../../etc/passwd")).toBe(
      "http://127.0.0.1:8080/reports/..%2F..%2Fetc%2Fpasswd/sarif",
    );
  });

  it("fetches the export as bytes rather than parsing it in the browser", async () => {
    const blob = new Blob(["{}"], { type: "application/sarif+json" });
    get.mockResolvedValue({ data: blob });

    await expect(assessmentApi.downloadReportSarif("r1")).resolves.toBe(blob);
    expect(get).toHaveBeenCalledWith("/reports/r1/sarif", { responseType: "blob" });
  });

  it("reports a run with no SARIF as absent rather than as an error", async () => {
    get.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));

    await expect(assessmentApi.downloadReportSarif("r1")).resolves.toBeNull();
    await expect(assessmentApi.getReportSarif("r1")).resolves.toBeNull();
  });

  it("still surfaces a real backend fault while downloading", async () => {
    get.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));

    await expect(assessmentApi.downloadReportSarif("r1")).rejects.toThrow("boom");
  });
});
