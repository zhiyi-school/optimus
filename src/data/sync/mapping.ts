import type { RiskVerdict } from "@/api/automation-types";
import type { FindingStatus } from "@/data/types";

export interface RunCancelToken {
  cancelled: boolean;
}

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
