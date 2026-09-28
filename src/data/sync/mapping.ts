/**
 * Run cancellation token and the mapping from automation verdicts to finding statuses.
 */

import type { RiskVerdict } from "@/api/automation-types";
import type { FindingStatus } from "@/data/types";

export interface RunCancelToken {
  cancelled: boolean;
}

/** Maps an automation verdict to a finding status; anything unrecognised is inconclusive. */
export function mapVerdictToFindingStatus(verdict: RiskVerdict | string): FindingStatus {
  switch (verdict) {
    case "At Risk":
      return "at_risk";
    case "Reduced Risk":
      return "reduced_risk";
    case "Inconclusive":
    default:
      return "inconclusive";
  }
}
