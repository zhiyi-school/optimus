import { describe, expect, it } from "vitest";
import { canonicalRiskPath, type RiskLocation } from "./legacy-routes";

const linked: RiskLocation = {
  applicationId: "example-app-id",
  assessmentId: "example-assessment-id",
  riskId: "example-feature-01-risk-01",
};

const security = { security: true, developer: false };
const developer = { security: false, developer: true };
const both = { security: true, developer: true };

describe("where an old link lands", () => {
  it("sends security to the assessment's own feature-risk", () => {
    expect(canonicalRiskPath(linked, security)).toBe(
      "/assessments/example-assessment-id/tests/example-feature-01-risk-01",
    );
  });

  it("sends a developer to the same risk under Resolve", () => {
    expect(canonicalRiskPath(linked, developer)).toBe(
      "/resolve/applications/example-app-id/risks/example-feature-01-risk-01",
    );
  });

  it("is deterministic for a user holding both roles", () => {
    expect(canonicalRiskPath(linked, both)).toBe(canonicalRiskPath(linked, security));
  });

  it("falls back to Resolve for a developer-only record with no assessment", () => {
    expect(canonicalRiskPath({ ...linked, assessmentId: null }, both)).toBe(
      "/resolve/applications/example-app-id/risks/example-feature-01-risk-01",
    );
  });

  it("carries a control through to the manual steps of that risk", () => {
    expect(
      canonicalRiskPath(linked, { ...security, controlId: "example-control-01" }),
    ).toContain("/manual");
  });

  it("escapes a risk id rather than trusting it in a path", () => {
    const path = canonicalRiskPath({ ...linked, riskId: "../../etc/passwd" }, security);
    expect(path).not.toContain("../");
    expect(path).toContain("%2F");
  });

  it("never targets a route that would bounce back to itself", () => {
    for (const audience of [security, developer, both]) {
      const path = canonicalRiskPath(linked, audience);
      expect(path?.startsWith("/findings")).toBe(false);
      expect(path?.startsWith("/tickets")).toBe(false);
    }
  });
});

describe("records that cannot be placed", () => {
  it("refuses a record with no risk", () => {
    expect(canonicalRiskPath({ ...linked, riskId: null }, both)).toBeNull();
    expect(canonicalRiskPath({ ...linked, riskId: "   " }, both)).toBeNull();
  });

  it("refuses a record with neither an assessment nor an application", () => {
    expect(
      canonicalRiskPath({ applicationId: null, assessmentId: null, riskId: "example-risk" }, both),
    ).toBeNull();
  });

  it("refuses to place a record for someone with neither role", () => {
    expect(canonicalRiskPath(linked, { security: false, developer: false })).toBeNull();
  });

  it("does not send a security-only user to a developer route they cannot open", () => {
    expect(canonicalRiskPath({ ...linked, assessmentId: null }, security)).toBeNull();
  });
});
