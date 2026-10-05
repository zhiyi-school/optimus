import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();

vi.mock("@/automation-api/client", () => ({
  automationAssetUrl: (path: string) => `http://127.0.0.1:8080${path}`,
  automationClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    defaults: { baseURL: "http://127.0.0.1:8080" },
  },
}));

const { iconApi, missingBuildMessage, provisioningApi, syncApi } = await import("./endpoints");

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

const { assessmentApi } = await import("./endpoints");

describe("SARIF export", () => {
  it("fetches the export as bytes rather than parsing it in the browser", async () => {
    const blob = new Blob(["{}"], { type: "application/sarif+json" });
    get.mockResolvedValue({ data: blob });

    await expect(assessmentApi.downloadReportSarif("r1")).resolves.toBe(blob);
    expect(get).toHaveBeenCalledWith("/reports/r1/sarif", { responseType: "blob" });
  });

  it("reports a run with no SARIF as absent rather than as an error", async () => {
    get.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));

    await expect(assessmentApi.downloadReportSarif("r1")).resolves.toBeNull();
  });

  it("still surfaces a real backend fault while downloading", async () => {
    get.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));

    await expect(assessmentApi.downloadReportSarif("r1")).rejects.toThrow("boom");
  });
});

describe("evidence URL", () => {
  it("sends the opaque ref and never the display path", () => {
    expect(assessmentApi.evidenceFileUrl("run one", "opaque/ref?value")).toBe(
      "http://127.0.0.1:8080/reports/run%20one/evidence-file?ref=opaque%2Fref%3Fvalue",
    );
  });
});

describe("iconApi", () => {
  it("builds the icon URL from the platform and backend app id", () => {
    expect(iconApi.url("ios", "example_app")).toBe(
      "http://127.0.0.1:8080/config/ios/apps/example_app/icon",
    );
  });

  it("escapes an app id rather than letting it shape the path", () => {
    expect(iconApi.url("android", "../secrets")).toBe(
      "http://127.0.0.1:8080/config/android/apps/..%2Fsecrets/icon",
    );
  });

  it("appends the build checksum as a cache-busting version", () => {
    expect(iconApi.url("ios", "example_app", "c".repeat(64))).toBe(
      `http://127.0.0.1:8080/config/ios/apps/example_app/icon?v=${"c".repeat(64)}`,
    );
  });

});

describe("listReports", () => {
  it("sends no filters when none are given", async () => {
    get.mockResolvedValue({ data: [] });

    await assessmentApi.listReports();

    expect(get).toHaveBeenCalledWith("/reports", { params: undefined });
  });

  it("joins the sync statuses into one comma-separated parameter", async () => {
    get.mockResolvedValue({ data: ["2026-01-01_00-00-00"] });

    await expect(assessmentApi.listReports({ syncStatus: ["queued", "running"] })).resolves.toEqual([
      "2026-01-01_00-00-00",
    ]);
    expect(get).toHaveBeenCalledWith("/reports", { params: { sync_status: "queued,running" } });
  });

  it("sends the manifest status alongside the sync statuses", async () => {
    get.mockResolvedValue({ data: [] });

    await assessmentApi.listReports({ status: "completed", syncStatus: ["failed"] });

    expect(get).toHaveBeenCalledWith("/reports", { params: { status: "completed", sync_status: "failed" } });
  });
});

describe("listBuilds", () => {
  it("asks the backend for the app's intake builds", async () => {
    get.mockResolvedValue({ data: { builds: [], default_version: null, ambiguous: false } });

    await expect(provisioningApi.listBuilds("ios", "example_app")).resolves.toMatchObject({ builds: [] });
    expect(get).toHaveBeenCalledWith("/config/ios/apps/example_app/builds");
  });

  it("treats a backend without the endpoint as no builds", async () => {
    get.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));

    await expect(provisioningApi.listBuilds("ios", "example_app")).resolves.toBeNull();
  });
});

describe("missingBuildMessage", () => {
  it("returns the backend's message for a missing build", () => {
    const err = { status: 422, detail: { blocker_code: "app_build_missing", message: "No build of Example with version 3.9.9." } };

    expect(missingBuildMessage(err)).toBe("No build of Example with version 3.9.9.");
  });

  it("is null for any other refusal", () => {
    expect(missingBuildMessage({ status: 422, detail: "apps did not match" })).toBeNull();
    expect(missingBuildMessage(new Error("boom"))).toBeNull();
  });
});
