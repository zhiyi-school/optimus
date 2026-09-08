import { describe, expect, it } from "vitest";
import {
  artifactNamed,
  artifactsOf,
  automationEvidence,
  combinedEvidence,
  latestResult,
  latestResultDetail,
  RAIL_ARTIFACT_LIMIT,
} from "@/lib/automation-evidence";
import type { AutomationResultRow, EvidenceRef } from "@/api/automation-types";
import type { EvidenceItem } from "@/components/evidence";

const APP = "example_app";
const RISK = "example-feature-01-risk-01";

function row(overrides: Partial<AutomationResultRow> = {}): AutomationResultRow {
  return {
    app_id: APP,
    app_name: "Example Application",
    platform: "ios",
    package_or_bundle_id: "test.example.app",
    test_id: RISK,
    test_name: "Example risk",
    category: "example",
    status: "ANALYSIS_COMPLETE",
    verdict: "At Risk",
    severity: "high",
    summary: "The example check did not pass.",
    started_at: "2026-01-02T00:00:00Z",
    completed_at: "2026-01-02T00:01:00Z",
    duration_seconds: 42,
    evidence: [],
    report_path: "ios/example_app/example-feature-01-risk-01/example_case",
    run_timestamp: "2026-01-02_00-00-00",
    raw: {},
    ...overrides,
  };
}

function artifact(name: string, kind = "report"): EvidenceRef {
  return {
    kind,
    label: name,
    path: `reports/2026-01-02_00-00-00/${name}`,
    ref: `ref-${name}`,
    size_bytes: 128,
  };
}

const url = (runTimestamp: string, path: string) => `/example/${runTimestamp}?path=${path}`;

describe("choosing the result the rail describes", () => {
  it("takes the newest run of this application and risk", () => {
    const chosen = latestResult(
      [
        row({ run_timestamp: "older", started_at: "2026-01-01T00:00:00Z" }),
        row({ run_timestamp: "newest", started_at: "2026-01-03T00:00:00Z" }),
        row({ run_timestamp: "middle", started_at: "2026-01-02T00:00:00Z" }),
      ],
      APP,
      RISK,
    );

    expect(chosen?.run_timestamp).toBe("newest");
  });

  it("never crosses to another application", () => {
    const chosen = latestResult(
      [row({ app_id: "other_app", started_at: "2026-01-09T00:00:00Z" })],
      APP,
      RISK,
    );
    expect(chosen).toBeUndefined();
  });

  it("never crosses to another risk on the same application", () => {
    const chosen = latestResult(
      [row({ test_id: "example-feature-02-risk-01", started_at: "2026-01-09T00:00:00Z" })],
      APP,
      RISK,
    );
    expect(chosen).toBeUndefined();
  });

  it("has nothing to describe without both an application and a risk", () => {
    expect(latestResult([row()], undefined, RISK)).toBeUndefined();
    expect(latestResult([row()], APP, undefined)).toBeUndefined();
    expect(latestResult(undefined, APP, RISK)).toBeUndefined();
  });
});

describe("the latest result, presented in full", () => {
  it("keeps every fact in its own field rather than one truncated line", () => {
    const detail = latestResultDetail(row())!;

    expect(detail.verdict).toBe("At Risk");
    expect(detail.status).toBe("ANALYSIS_COMPLETE");
    expect(detail.runTimestamp).toBe("2026-01-02_00-00-00");
    expect(detail.startedAt).toContain("2026");
    expect(detail.duration).toBeTruthy();
    expect(detail.summary).toBe("The example check did not pass.");
    expect(detail.testId).toBe(RISK);
    expect(detail.testName).toBe("Example risk");
  });

  it("says so plainly when the run recorded no summary", () => {
    expect(latestResultDetail(row({ summary: "" }))!.summary).toBe("The run recorded no summary.");
  });

  it("omits a duration the run did not record", () => {
    expect(latestResultDetail(row({ duration_seconds: 0 }))!.duration).toBeNull();
  });

  it("has nothing to describe without a result", () => {
    expect(latestResultDetail(undefined)).toBeUndefined();
  });
});

describe("the run's artefacts", () => {
  it("lists one entry per file, in the order the backend offered them", () => {
    const artifacts = artifactsOf(row({ evidence: [artifact("report.json"), artifact("logs.txt")] }));
    expect(artifacts.map((item) => item.path.split("/").pop())).toEqual([
      "report.json",
      "logs.txt",
    ]);
  });

  it("drops an artefact the run listed twice", () => {
    expect(artifactsOf(row({ evidence: [artifact("report.json"), artifact("report.json")] })))
      .toHaveLength(1);
  });

  it("drops an artefact with no handle to fetch it by", () => {
    const orphan = { ...artifact("report.json"), ref: "" };
    expect(artifactsOf(row({ evidence: [orphan] }))).toEqual([]);
  });

  it("finds a named artefact by its file name", () => {
    const found = artifactNamed(
      row({ evidence: [artifact("logs.txt"), artifact("critical_findings.json")] }),
      "critical_findings.json",
    );
    expect(found?.ref).toBe("ref-critical_findings.json");
    expect(artifactNamed(row(), "critical_findings.json")).toBeUndefined();
  });
});

describe("the artefacts as rail items", () => {
  it("offers each artefact by its label, fetched through the opaque handle", () => {
    const items = automationEvidence(row({ evidence: [artifact("report.json")] }), url);

    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("report.json");
    expect(items[0].url).toBe("/example/2026-01-02_00-00-00?path=ref-report.json");
    expect(items[0].downloadName).toBe("report.json");
    expect(items[0].sizeBytes).toBe(128);
  });

  it("never puts a raw filesystem path on screen", () => {
    const items = automationEvidence(
      row({
        evidence: [
          { kind: "log", label: "Run log", path: "work/run/logs.txt", ref: "r", size_bytes: 12 },
        ],
      }),
      url,
    );
    expect(items[0].name).toBe("Run log");
    expect(items[0].downloadName).toBe("logs.txt");
  });

  it("shows an artefact with no label by its file name", () => {
    const items = automationEvidence(
      row({
        evidence: [
          { kind: "log", label: "", path: "reports/run/nested/logs.txt", ref: "r", size_bytes: 1 },
        ],
      }),
      url,
    );
    expect(items[0].name).toBe("logs.txt");
  });

  it("keys items on the run and the handle, so nothing collides across runs", () => {
    const first = automationEvidence(row({ evidence: [artifact("report.json")] }), url);
    const second = automationEvidence(
      row({ run_timestamp: "2026-01-09_00-00-00", evidence: [artifact("report.json")] }),
      url,
    );

    expect(first[0].id).not.toBe(second[0].id);
  });

  it("renders a screenshot as an image and a log as text", () => {
    const items = automationEvidence(
      row({
        evidence: [
          {
            kind: "screenshot",
            label: "Target screen",
            path: "reports/run/target_screen.png",
            ref: "a",
            size_bytes: 9,
          },
          { kind: "log", label: "Run log", path: "reports/run/logs.txt", ref: "b", size_bytes: 9 },
        ],
      }),
      url,
    );

    expect(items[0].kind).toBe("image");
    expect(items[1].kind).toBe("text");
  });

  it("caps the narrow rail and says how much is left in the run", () => {
    const many = Array.from({ length: 17 }, (_, index) => artifact(`file-${index}.json`));
    const items = automationEvidence(row({ evidence: many }), url);

    expect(items.length).toBe(RAIL_ARTIFACT_LIMIT + 1);
    expect(items[items.length - 1].name).toBe("11 more artefacts in this run");
    expect(items[items.length - 1].url).toBeUndefined();
  });

  it("says nothing at all when there is no result yet", () => {
    expect(automationEvidence(undefined, url)).toEqual([]);
  });
});

describe("automated and manual evidence together", () => {
  const manual: EvidenceItem[] = [{ id: "manual-1", name: "Reviewer note", kind: "text" }];

  it("labels each side so a reader can tell them apart", () => {
    const items = combinedEvidence(row({ evidence: [artifact("report.json")] }), manual, url);

    expect(items[0].source).toBe("Automated test");
    expect(items[items.length - 1].source).toBe("Security team");
  });

  it("keeps the automated artefacts first", () => {
    const items = combinedEvidence(row({ evidence: [artifact("report.json")] }), manual, url);
    expect(items.map((item) => item.id)).toEqual([
      "2026-01-02_00-00-00:ref-report.json",
      "manual-1",
    ]);
  });

  it("still shows what security recorded when there is no automated result", () => {
    expect(combinedEvidence(undefined, manual, url)).toHaveLength(1);
  });

  it("leaves a source the caller already set alone", () => {
    const items = combinedEvidence(undefined, [{ ...manual[0], source: "Example source" }], url);
    expect(items[0].source).toBe("Example source");
  });
});
