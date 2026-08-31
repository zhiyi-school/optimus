export { mapVerdictToFindingStatus } from "./sync/mapping";
export type { RunCancelToken } from "./sync/mapping";
export { addApp } from "./sync/provisioning";
export { findActiveRun, findPlatformRun, riskProgressInRun, runAllTests, runAndWait } from "./sync/runs";
export type {
  ActiveRunFilter,
  RiskRunPhase,
  RiskRunProgress,
  RunOutcome,
  RunWaitResult,
} from "./sync/runs";

import { addApp } from "./sync/provisioning";
import { runAllTests, runAndWait } from "./sync/runs";

export const syncService = {
  addApp,
  runAllTests,
  runAndWait,
};
