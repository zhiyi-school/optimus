import { describe, expect, it } from "vitest";
import {
  findingAsText,
  parseCriticalFindings,
  severityCounts,
  severityRank,
  severityTone,
} from "@/lib/critical-findings";

/** The shape the backend's `critical_findings.json` records. */
const report = {
  status: "RISK_EXISTS",
  highest_severity: "HIGH",
  owasp_reference: "MASVS-STORAGE-1",
  flag_count: 3,
  flags: [
    {
      id: "EXAMPLE_LOW",
      severity: "LOW",
      title: "Native framework dependencies are visible",
      evidence: ["Frameworks: 2"],
      recommendation: "No action required.",
    },
    {
      id: "EXAMPLE_HIGH",
      severity: "HIGH",
      title: "Potential sensitive information is present",
      evidence: ["HIGH EXAMPLE_KEY in Example.plist: $.KEY = example-value"],
      recommendation: "Move the value out of the bundle.",
    },
    {
      id: "EXAMPLE_MEDIUM",
      severity: "MEDIUM",
      title: "Custom URL schemes are exposed",
      evidence: [],
      recommendation: "",
    },
  ],
};

describe("reading the structured static-analysis report", () => {
  it("keeps the document's own status, highest severity and reference", () => {
    const parsed = parseCriticalFindings(report)!;
    expect(parsed.status).toBe("RISK_EXISTS");
    expect(parsed.highestSeverity).toBe("HIGH");
    expect(parsed.owaspReference).toBe("MASVS-STORAGE-1");
  });

  it("orders findings worst first", () => {
    expect(parseCriticalFindings(report)!.findings.map((f) => f.severity)).toEqual([
      "HIGH",
      "MEDIUM",
      "LOW",
    ]);
  });

  it("carries each finding's title, evidence and recommendation", () => {
    const worst = parseCriticalFindings(report)!.findings[0];
    expect(worst.title).toBe("Potential sensitive information is present");
    expect(worst.evidence).toEqual([
      "HIGH EXAMPLE_KEY in Example.plist: $.KEY = example-value",
    ]);
    expect(worst.recommendation).toBe("Move the value out of the bundle.");
  });

  it("derives the highest severity when the document omits it", () => {
    const parsed = parseCriticalFindings({ ...report, highest_severity: "" })!;
    expect(parsed.highestSeverity).toBe("HIGH");
  });

  it("keeps a finding with no evidence rather than dropping it", () => {
    const parsed = parseCriticalFindings(report)!;
    expect(parsed.findings.find((f) => f.id === "EXAMPLE_MEDIUM")?.evidence).toEqual([]);
  });

  it("skips a malformed flag without losing the rest", () => {
    const parsed = parseCriticalFindings({
      ...report,
      flags: [...report.flags, null, { severity: "HIGH" }, "nonsense"],
    })!;
    expect(parsed.findings).toHaveLength(3);
  });

  it("gives an unlabelled severity a place rather than crashing", () => {
    const parsed = parseCriticalFindings({
      flags: [{ title: "Example", severity: "", evidence: [], recommendation: "" }],
    })!;
    expect(parsed.findings[0].severity).toBe("INFO");
  });

  it("has nothing to show for an empty or unrecognised document", () => {
    expect(parseCriticalFindings(undefined)).toBeUndefined();
    expect(parseCriticalFindings("not a report")).toBeUndefined();
    expect(parseCriticalFindings({ flags: [] })).toBeUndefined();
  });

  it("still reports a clean run that recorded a status", () => {
    const parsed = parseCriticalFindings({ status: "NO_RISK", flags: [] })!;
    expect(parsed.status).toBe("NO_RISK");
    expect(parsed.findings).toEqual([]);
  });
});

describe("severity presentation", () => {
  it("ranks the worst first and the unknown last", () => {
    expect(severityRank("CRITICAL")).toBeLessThan(severityRank("HIGH"));
    expect(severityRank("HIGH")).toBeLessThan(severityRank("LOW"));
    expect(severityRank("NONSENSE")).toBeGreaterThan(severityRank("INFO"));
  });

  it("tones the dangerous severities as dangerous", () => {
    expect(severityTone.CRITICAL).toBe("danger");
    expect(severityTone.HIGH).toBe("danger");
    expect(severityTone.MEDIUM).toBe("warning");
  });

  it("counts each severity, worst first", () => {
    const parsed = parseCriticalFindings(report)!;
    expect(severityCounts(parsed.findings)).toEqual([
      { severity: "HIGH", count: 1 },
      { severity: "MEDIUM", count: 1 },
      { severity: "LOW", count: 1 },
    ]);
  });
});

describe("copying a finding", () => {
  it("writes the same facts the table shows, and nothing else", () => {
    const worst = parseCriticalFindings(report)!.findings[0];
    expect(findingAsText(worst)).toBe(
      [
        "HIGH: Potential sensitive information is present",
        "  - HIGH EXAMPLE_KEY in Example.plist: $.KEY = example-value",
        "  Recommendation: Move the value out of the bundle.",
      ].join("\n"),
    );
  });

  it("omits an absent recommendation rather than printing an empty line", () => {
    const medium = parseCriticalFindings(report)!.findings[1];
    expect(findingAsText(medium)).toBe("MEDIUM: Custom URL schemes are exposed");
  });
});
