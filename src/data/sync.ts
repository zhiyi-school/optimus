export { mapVerdictToFindingStatus } from "./sync/mapping";
export type { RunCancelToken } from "./sync/mapping";
export { addApp } from "./sync/provisioning";
export { findActiveRun, findPlatformRun, riskProgressInRun, runAndWait } from "./sync/runs";
export type {
  ActiveRunFilter,
  RiskRunPhase,
  RiskRunProgress,
  RunOutcome,
  RunWaitResult,
} from "./sync/runs";

import { addApp } from "./sync/provisioning";
import { runAndWait } from "./sync/runs";

export const syncService = {
  addApp,
  runAndWait,
};
