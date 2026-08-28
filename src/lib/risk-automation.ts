import type { RiskDefinition } from "@/api/automation-types";

/**
 * Fallback for risks the backend hasn't flagged yet. The catalogue reports
 * `automation_available` per risk, so this should normally stay empty.
 */
const MANUAL_ONLY_RISKS = new Set<string>([]);

/** Ids of every risk an automated run should actually cover. */
export function automatedRiskIds(risks: RiskDefinition[] | undefined): string[] {
  return (risks ?? []).filter(hasAutomation).map((risk) => risk.risk_id);
}

export function hasAutomation(
  risk: Pick<RiskDefinition, "risk_id"> | undefined | null,
): boolean {
  if (!risk) return true;
  const declared = (risk as Partial<RiskDefinition>).automation_available;
  if (typeof declared === "boolean") return declared;
  return !MANUAL_ONLY_RISKS.has(risk.risk_id);
}
