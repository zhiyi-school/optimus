/**
 * Builds the Resolve workspace path for a feature-risk.
 */

import { createDebug } from "@/lib/debug";

const debug = createDebug("routing:risk-routes");

/** Returns the Resolve risk page, falling back to the application, then Resolve, when links are missing. */
export function resolveRiskPath(location: {
  applicationId: string | null | undefined;
  riskId: string | null | undefined;
}): string {
  const riskId = location.riskId?.trim();
  const applicationId = location.applicationId?.trim();
  debug("resolves risk path", { applicationId, riskId });
  if (!applicationId) return "/resolve";
  if (!riskId) return `/resolve/applications/${applicationId}`;
  return `/resolve/applications/${applicationId}/risks/${encodeURIComponent(riskId)}`;
}
