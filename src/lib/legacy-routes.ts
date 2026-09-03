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

/**
 * The one place old finding and ticket links are mapped onto a workspace.
 * Security wins for a mixed-role user because a finding raised against an
 * assessment is security's own record; developers reach the same risk through
 * Resolve. Returns null when the record is too unlinked to place.
 */
export function canonicalRiskPath(
  location: RiskLocation,
  audience: RiskAudience,
): string | null {
  const riskId = location.riskId?.trim();
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
