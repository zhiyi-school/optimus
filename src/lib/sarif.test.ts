import { describe, expect, it } from "vitest";
import type { RunRecord } from "@/api/automation-types";
import { canExportSarif, sarifFileName } from "./sarif";

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    run_id: "2026-01-01_00-00-00",
    run_timestamp: "2026-01-01_00-00-00",
    platform: "ios",
    config_path: "configs/ios.yaml",
    status: "completed",
    run_dir: "reports/2026-01-01_00-00-00",
    error: null,
    started_at: "2026-01-01T00:00:00+08:00",
    completed_at: "2026-01-01T00:00:02+08:00",
    apps: "example_app",
    risks: "example_risk",
    ...overrides,
  } as RunRecord;
}

describe("canExportSarif", () => {
  it("offers the export for a completed run", () => {
    expect(canExportSarif(run())).toBe(true);
  });

  it("hides it while the run is still going", () => {
    expect(canExportSarif(run({ status: "running" }))).toBe(false);
  });

  it("hides it for a failed run, which the backend refuses to export", () => {
    expect(canExportSarif(run({ status: "failed" }))).toBe(false);
  });

  it("hides it when there is no run to export", () => {
    expect(canExportSarif(null)).toBe(false);
    expect(canExportSarif(undefined)).toBe(false);
    expect(canExportSarif(run({ run_timestamp: "" }))).toBe(false);
  });
});

describe("sarifFileName", () => {
  it("names the download after the run", () => {
    expect(sarifFileName("2026-01-01_00-00-00")).toBe("2026-01-01_00-00-00.sarif");
  });

  it("cannot produce a path or a hidden traversal", () => {
    expect(sarifFileName("../../etc/passwd")).toBe(".._.._etc_passwd.sarif");
    expect(sarifFileName("")).toBe("run.sarif");
  });
});
