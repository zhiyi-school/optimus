import { describe, expect, it } from "vitest";
import {
  newestCompletedAssessment,
  assessmentVersion,
  buildOptionLabel,
  canStartNewAssessment,
  selectableVersions,
} from "@/domain/assessment/build-versions";
import type { AppBuild } from "@/automation-api/types";

const build = (overrides: Partial<AppBuild>): AppBuild => ({
  version: "4.3.4",
  build_number: "12",
  file: "Example_4.3.4.ipa",
  modified_at: 0,
  ...overrides,
});

describe("labelling builds in the version picker", () => {
  it("names the version, build number and file", () => {
    expect(buildOptionLabel(build({}))).toBe("4.3.4 (build 12) — Example_4.3.4.ipa");
  });

  it("leaves out a build number that only repeats the version", () => {
    expect(buildOptionLabel(build({ build_number: "4.3.4" }))).toBe("4.3.4 — Example_4.3.4.ipa");
  });

  it("says when a build carries no version", () => {
    expect(buildOptionLabel(build({ version: null, build_number: null }))).toBe("Unknown version — Example_4.3.4.ipa");
  });

  it("offers each version once, keeping the backend's highest-first order", () => {
    const builds = [build({}), build({ build_number: "11" }), build({ version: "3.9.9" }), build({ version: null })];

    expect(selectableVersions(builds)).toEqual(["4.3.4", "3.9.9"]);
  });
});

describe("starting a new assessment", () => {
  it("is allowed once every assessment of the app has finished", () => {
    expect(canStartNewAssessment([{ status: "completed" }, { status: "failed" }])).toBe(true);
    expect(canStartNewAssessment([])).toBe(true);
  });

  it.each(["queued", "waiting", "running"] as const)("is refused while one is %s", (status) => {
    expect(canStartNewAssessment([{ status: "completed" }, { status }])).toBe(false);
  });
});

describe("the version an assessment shows", () => {
  it("prefers the version the assessment tested", () => {
    expect(assessmentVersion({ app_version: "3.9.9" }, { version: "4.3.4" })).toBe("3.9.9");
  });

  it("falls back to the application's version, then nothing", () => {
    expect(assessmentVersion({ app_version: null }, { version: "4.3.4" })).toBe("4.3.4");
    expect(assessmentVersion({ app_version: null }, null)).toBeNull();
  });
});

describe("newestCompletedAssessment", () => {
  const row = (id: string, status: "completed" | "queued" | "failed", created_at: string) => ({ id, status, created_at });

  it("picks the newest completed assessment, ignoring ones still running or failed", () => {
    const rows = [
      row("old", "completed", "2026-01-01T00:00:00Z"),
      row("new", "completed", "2026-02-01T00:00:00Z"),
      row("queued", "queued", "2026-03-01T00:00:00Z"),
      row("failed", "failed", "2026-04-01T00:00:00Z"),
    ];
    expect(newestCompletedAssessment(rows)?.id).toBe("new");
  });

  it("finds none before any assessment completes", () => {
    expect(newestCompletedAssessment([row("queued", "queued", "2026-01-01T00:00:00Z")])).toBeNull();
  });
});
