import { describe, expect, it } from "vitest";
import { resolveRiskPath } from "./risk-routes";

describe("resolveRiskPath", () => {
  it("opens the risk page that holds the conversation", () => {
    expect(resolveRiskPath({ applicationId: "example-app-id", riskId: "example-feature-01-risk-01" }))
      .toBe("/resolve/applications/example-app-id/risks/example-feature-01-risk-01");
  });

  it("url-encodes a risk id that needs it", () => {
    expect(resolveRiskPath({ applicationId: "example-app-id", riskId: "example risk/01" }))
      .toBe("/resolve/applications/example-app-id/risks/example%20risk%2F01");
  });

  it("falls back to the application when no risk is named", () => {
    expect(resolveRiskPath({ applicationId: "example-app-id", riskId: "  " }))
      .toBe("/resolve/applications/example-app-id");
  });

  it("falls back to Resolve when no application is named", () => {
    expect(resolveRiskPath({ applicationId: null, riskId: "example-feature-01-risk-01" })).toBe("/resolve");
  });
});
