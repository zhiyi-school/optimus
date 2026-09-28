/**
 * Whether a risk can be tested by automation.
 */

import type { RiskDefinition } from "@/api/automation-types";

/** Fallback for risks the backend has not flagged; normally empty, since risks report `automation_available`. */
const MANUAL_ONLY_RISKS = new Set<string>([]);

/** True when the risk is automatable, per the backend's flag or else the manual-only fallback list. */
export function hasAutomation(
  risk: Pick<RiskDefinition, "risk_id"> | undefined | null,
): boolean {
  if (!risk) return true;
  const declared = (risk as Partial<RiskDefinition>).automation_available;
  if (typeof declared === "boolean") return declared;
  return !MANUAL_ONLY_RISKS.has(risk.risk_id);
}
