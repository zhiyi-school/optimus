import { describe, expect, it } from "vitest";
import { latestAssessmentPerApp, preferredAssessmentRisk, type AssessmentRow } from "./assessments";
import type { Finding, FindingStatus } from "@/data/types";

const CATALOGUE = [
  { risk_id: "example-feature-01-risk-01" },
  { risk_id: "example-feature-01-risk-02" },
  { risk_id: "example-feature-01-risk-03" },
  { risk_id: "example-feature-01-risk-04" },
];

function finding(testId: string, status: FindingStatus): Finding {
  return {
    id: `finding-${testId}`,
    application_id: "example-app-id",
    assessment_id: "example-assessment-id",
    test_id: testId,
    title: "Example finding",
    status,
    severity: "high",
    platform: "ios",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  } as Finding;
}

function row(overrides: Partial<AssessmentRow>): AssessmentRow {
  return {
    id: "example-assessment-id",
    application_id: "example-app-id",
    application: null,
    status: "completed",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as AssessmentRow;
}

describe("the feature-risk a completed assessment opens on", () => {
  it("prefers a risk that is still at risk", () => {
    const findings = [
      finding("example-feature-01-risk-01", "reduced_risk"),
      finding("example-feature-01-risk-02", "inconclusive"),
      finding("example-feature-01-risk-03", "at_risk"),
    ];
    expect(preferredAssessmentRisk(CATALOGUE, findings)).toBe("example-feature-01-risk-03");
  });

  it("falls back to an inconclusive risk when nothing is at risk", () => {
    const findings = [
      finding("example-feature-01-risk-01", "reduced_risk"),
      finding("example-feature-01-risk-02", "inconclusive"),
    ];
    expect(preferredAssessmentRisk(CATALOGUE, findings)).toBe("example-feature-01-risk-02");
  });

  it("falls back to an untested risk before a resolved one", () => {
    const findings = [
      finding("example-feature-01-risk-01", "reduced_risk"),
      finding("example-feature-01-risk-02", "reduced_risk"),
    ];
    expect(preferredAssessmentRisk(CATALOGUE, findings)).toBe("example-feature-01-risk-03");
  });

  it("falls back to the first catalogue risk when every risk is resolved", () => {
    const findings = CATALOGUE.map((risk) => finding(risk.risk_id, "reduced_risk"));
    expect(preferredAssessmentRisk(CATALOGUE, findings)).toBe("example-feature-01-risk-01");
  });

  it("uses catalogue order, not finding order, as the tie-breaker", () => {
    const findings = [
      finding("example-feature-01-risk-04", "at_risk"),
      finding("example-feature-01-risk-02", "at_risk"),
    ];
    expect(preferredAssessmentRisk(CATALOGUE, findings)).toBe("example-feature-01-risk-02");
  });

  it("opens the first risk when the assessment has recorded no findings at all", () => {
    expect(preferredAssessmentRisk(CATALOGUE, [])).toBe("example-feature-01-risk-01");
    expect(preferredAssessmentRisk(CATALOGUE, undefined)).toBe("example-feature-01-risk-01");
  });

  it("has nothing to open when the backend returned no catalogue", () => {
    expect(preferredAssessmentRisk([], [])).toBeNull();
    expect(preferredAssessmentRisk(undefined, [])).toBeNull();
  });

  it("ignores a finding that is not linked to a catalogue risk", () => {
    const findings = [finding("example-feature-01-risk-01", "reduced_risk")];
    findings.push({ ...finding("x", "at_risk"), test_id: null } as Finding);
    expect(preferredAssessmentRisk(CATALOGUE, findings)).toBe("example-feature-01-risk-02");
  });
});

describe("one row per application", () => {
  it("keeps the most recently updated assessment of each app", () => {
    const rows = latestAssessmentPerApp([
      row({ id: "older", updated_at: "2026-01-01T00:00:00Z" }),
      row({ id: "newer", updated_at: "2026-02-01T00:00:00Z" }),
    ]);
    expect(rows.map((entry) => entry.id)).toEqual(["newer"]);
  });

  it("sorts the result alphabetically by application name", () => {
    const rows = latestAssessmentPerApp([
      row({ id: "a", application_id: "app-z", application: { name: "Zebra App" } as never }),
      row({ id: "b", application_id: "app-a", application: { name: "apple app" } as never }),
      row({ id: "c", application_id: "app-m", application: { name: "Mango App" } as never }),
    ]);
    expect(rows.map((entry) => entry.application?.name)).toEqual([
      "apple app",
      "Mango App",
      "Zebra App",
    ]);
  });

  it("breaks a tie on missing names deterministically by application id", () => {
    const rows = latestAssessmentPerApp([
      row({ id: "a", application_id: "app-b", application: null }),
      row({ id: "b", application_id: "app-a", application: null }),
    ]);
    expect(rows.map((entry) => entry.application_id)).toEqual(["app-a", "app-b"]);
  });

  it("does not mutate the array it was given", () => {
    const input = [
      row({ id: "a", application_id: "app-z", application: { name: "Zebra App" } as never }),
      row({ id: "b", application_id: "app-a", application: { name: "Apple App" } as never }),
    ];
    const copy = [...input];
    latestAssessmentPerApp(input);
    expect(input).toEqual(copy);
  });
});
