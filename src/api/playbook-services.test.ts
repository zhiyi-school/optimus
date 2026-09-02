import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();

vi.mock("@/api/automation-client", () => ({
  automationAssetUrl: (path: string) => `http://127.0.0.1:8080${path}`,
  automationClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    defaults: { baseURL: "http://127.0.0.1:8080" },
  },
}));

const { playbookApi } = await import("./playbook-services");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listRiskControls", () => {
  it("asks the backend for the controls that address a risk", async () => {
    get.mockResolvedValue({ data: [{ control_id: "example-feature-01-risk-01-control-01" }] });

    await expect(
      playbookApi.listRiskControls("ios", "example-feature-01-risk-01"),
    ).resolves.toHaveLength(1);
    expect(get).toHaveBeenCalledWith(
      "/platforms/ios/risks/example-feature-01-risk-01/controls",
    );
  });

  it("escapes a risk id so it cannot alter the path", async () => {
    get.mockResolvedValue({ data: [] });

    await playbookApi.listRiskControls("ios", "../../secrets");
    expect(get).toHaveBeenCalledWith("/platforms/ios/risks/..%2F..%2Fsecrets/controls");
  });

  it("surfaces a backend fault rather than pretending there are no controls", async () => {
    get.mockRejectedValue(Object.assign(new Error("unreadable"), { status: 503 }));

    await expect(playbookApi.listRiskControls("ios", "example-feature-01-risk-01")).rejects.toThrow(
      "unreadable",
    );
  });
});

describe("getControl", () => {
  it("fetches one control's remediation steps", async () => {
    get.mockResolvedValue({ data: { control_id: "c1", steps: [] } });

    await expect(
      playbookApi.getControl("ios", "example-feature-01-risk-01-control-01"),
    ).resolves.toMatchObject({ control_id: "c1" });
    expect(get).toHaveBeenCalledWith(
      "/platforms/ios/controls/example-feature-01-risk-01-control-01",
    );
  });

  it("surfaces a missing control instead of returning an empty one", async () => {
    get.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));

    await expect(playbookApi.getControl("ios", "absent")).rejects.toThrow("not found");
  });
});

describe("getControlSource", () => {
  it("reads the archive metadata without downloading it", async () => {
    get.mockResolvedValue({ data: { exists: true, file_name: "example.zip" } });

    await expect(playbookApi.getControlSource("ios", "c1")).resolves.toMatchObject({
      file_name: "example.zip",
    });
    expect(get).toHaveBeenCalledWith("/platforms/ios/controls/c1/source");
  });

  it("treats a backend without the endpoint as no archive", async () => {
    get.mockRejectedValue(Object.assign(new Error("no route"), { status: 405 }));

    await expect(playbookApi.getControlSource("ios", "c1")).resolves.toBeNull();
  });
});

describe("sourceDownloadUrl", () => {
  it("points at the download route on the automation host", () => {
    expect(playbookApi.sourceDownloadUrl("ios", "example-feature-01-risk-01-control-01")).toBe(
      "http://127.0.0.1:8080/platforms/ios/controls/example-feature-01-risk-01-control-01/source/download",
    );
  });

  it("escapes a control id", () => {
    expect(playbookApi.sourceDownloadUrl("ios", "a/b")).toBe(
      "http://127.0.0.1:8080/platforms/ios/controls/a%2Fb/source/download",
    );
  });
});

describe("playbook status", () => {
  it("reports the configured directory and any warnings", async () => {
    get.mockResolvedValue({
      data: { readable: true, control_count: 2, warnings: [{ code: "missing_image" }] },
    });

    await expect(playbookApi.getStatus("ios")).resolves.toMatchObject({ control_count: 2 });
    expect(get).toHaveBeenCalledWith("/platforms/ios/playbook/status");
  });

  it("treats an older backend as having no playbook support", async () => {
    get.mockRejectedValue(Object.assign(new Error("no route"), { status: 404 }));

    await expect(playbookApi.getStatus("ios")).resolves.toBeNull();
  });

  it("reloads the catalogue on request", async () => {
    post.mockResolvedValue({ data: { readable: true, control_count: 3 } });

    await expect(playbookApi.reload("ios")).resolves.toMatchObject({ control_count: 3 });
    expect(post).toHaveBeenCalledWith("/platforms/ios/playbook/reload");
  });
});
