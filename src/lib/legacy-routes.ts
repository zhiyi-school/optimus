/**
 * Maps legacy finding, ticket and remediation links onto the current workspace routes.
 */

import { createDebug } from "@/lib/debug";

const debug = createDebug("lib:legacy-routes");

export interface RiskLocation {
  applicationId: string | null | undefined;
  assessmentId: string | null | undefined;
  riskId: string | null | undefined;
}

export interface RiskAudience {
  security: boolean;
  developer: boolean;
  controlId?: string;
}

/** Maps an old finding or ticket link onto Assess (security first) or Resolve; null when too unlinked to place. */
export function canonicalRiskPath(
  location: RiskLocation,
  audience: RiskAudience,
): string | null {
  const riskId = location.riskId?.trim();
  debug("maps legacy link", {
    riskId,
    assessmentId: location.assessmentId,
    applicationId: location.applicationId,
    security: audience.security,
    developer: audience.developer,
    controlId: audience.controlId,
  });
  if (!riskId) return null;

  if (audience.security && location.assessmentId) {
    const base = `/assessments/${location.assessmentId}/tests/${encodeURIComponent(riskId)}`;
    return audience.controlId ? `${base}/manual` : base;
  }

  if (audience.developer && location.applicationId) {
    const base = `/resolve/applications/${location.applicationId}/risks/${encodeURIComponent(riskId)}`;
    return base;
  }

  return null;
}

/** The Resolve page for a remediation, degrading to the application, then Resolve, when links are missing. */
export function resolveRiskPath(
  location: Pick<RiskLocation, "applicationId" | "riskId">,
): string {
  const riskId = location.riskId?.trim();
  const applicationId = location.applicationId?.trim();
  debug("resolves risk path", { applicationId, riskId });
  if (!applicationId) return "/resolve";
  if (!riskId) return `/resolve/applications/${applicationId}`;
  return `/resolve/applications/${applicationId}/risks/${encodeURIComponent(riskId)}`;
}
