/**
 * Starting and polling automation runs, and locating active runs and a risk's progress within one.
 */

import { assessmentApi } from "@/api/automation-services";
import type {
  AutomationPlatform,
  RunProgressEvent,
  RunRecord,
  StartRunRequest,
} from "@/api/automation-types";
import { createDebug } from "@/lib/debug";

const debug = createDebug("workflows:automation-run");

export interface RunCancelToken {
  cancelled: boolean;
}

const RUN_POLL_INTERVAL_MS = 3000;
const RUN_POLL_MAX_ATTEMPTS = 120;

/** `cancelledWaiting`/`timedOutWaiting` mean this browser stopped watching, not that the run stopped. */
export type RunOutcome = "completed" | "failed" | "cancelledWaiting" | "timedOutWaiting";

export interface RunWaitResult {
  run: RunRecord;
  outcome: RunOutcome;
  dashboardSyncPending: boolean;
}

/** Starts a run and polls until it finishes, the caller cancels, or the poll limit is reached. */
export async function runAndWait(
  payload: StartRunRequest,
  onStarted?: (run: RunRecord) => unknown,
  cancelToken?: RunCancelToken,
): Promise<RunWaitResult> {
  debug("starting run and waiting", { fields: Object.keys(payload), cancellable: !!cancelToken });
  const started = await assessmentApi.startRun(payload);
  debug("run started", { runId: started.run_id, status: started.status });
  if (onStarted) {
    debug("notifying run start listener", { runId: started.run_id });
    await onStarted(started);
  }

  let latest = started;
  let attempts = 0;

  while (latest.status === "running" && attempts < RUN_POLL_MAX_ATTEMPTS) {
    if (cancelToken?.cancelled) {
      debug("stopped waiting; cancelled", { runId: started.run_id, attempts });
      return { run: latest, outcome: "cancelledWaiting", dashboardSyncPending: false };
    }
    await new Promise((resolve) => setTimeout(resolve, RUN_POLL_INTERVAL_MS));
    latest = await assessmentApi.getRun(started.run_id);
    attempts += 1;
    debug("polled run", { runId: started.run_id, attempt: attempts, status: latest.status });
  }

  if (latest.status === "completed") {
    debug("run completed; dashboard sync pending", { runId: started.run_id, attempts });
    return { run: latest, outcome: "completed", dashboardSyncPending: true };
  }
  if (latest.status === "failed") {
    debug("run failed", { runId: started.run_id, attempts });
    return { run: latest, outcome: "failed", dashboardSyncPending: false };
  }
  debug("stopped waiting; poll limit reached", {
    runId: started.run_id,
    attempts,
    status: latest.status,
  });
  return { run: latest, outcome: "timedOutWaiting", dashboardSyncPending: false };
}

export interface ActiveRunFilter {
  platform: AutomationPlatform | undefined;
  appExternalId: string | undefined;
  riskId?: string;
}

/** Lowercases an app selector and strips everything but letters and digits. */
function normalizeAppSelector(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** True when a run's CSV selection is empty or includes the wanted app or risk. */
function selectionCovers(csv: string | null | undefined, wanted: string, appSelector: boolean): boolean {
  if (!csv) return true;
  const target = appSelector ? normalizeAppSelector(wanted) : wanted.trim();
  return csv
    .split(",")
    .map((item) => (appSelector ? normalizeAppSelector(item) : item.trim()))
    .filter(Boolean)
    .includes(target);
}

/** Finds the newest running run covering this app (and risk), so a remounted page can resume its progress. */
export function findActiveRun(
  runs: RunRecord[] | undefined,
  filter: ActiveRunFilter,
): RunRecord | undefined {
  if (!filter.platform || !filter.appExternalId) return undefined;
  return runs
    ?.filter(
      (run) =>
        run.status === "running" &&
        run.platform === filter.platform &&
        selectionCovers(run.apps, filter.appExternalId as string, true) &&
        (!filter.riskId || selectionCovers(run.risks, filter.riskId, false)),
    )
    .sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""))[0];
}

/** Finds any running run occupying the platform's single device, whichever app or risk it covers. */
export function findPlatformRun(
  runs: RunRecord[] | undefined,
  platform: AutomationPlatform | undefined,
): RunRecord | undefined {
  if (!platform) return undefined;
  return runs?.find((run) => run.status === "running" && run.platform === platform);
}

/** Where one risk stands in a run; the device runs risks one at a time, so the rest wait queued. */
export type RiskRunPhase = "queued" | "running" | "done";

export interface RiskRunProgress {
  phase: RiskRunPhase;
  /** Risks of this run that have finished, and how many it set out to cover. */
  completed: number;
  total: number;
}

/** Derives one risk's phase and the run's completed/total risk counts from its progress events. */
export function riskProgressInRun(
  events: RunProgressEvent[] | undefined,
  run: RunRecord | undefined,
  appExternalId: string | undefined,
  riskId: string | undefined,
): RiskRunProgress | undefined {
  if (!run || !appExternalId || !riskId) return undefined;

  /** True when the event is for this app and risk. */
  const mine = (event: RunProgressEvent) =>
    event.app_id === appExternalId && event.risk_id === riskId;
  const completedHere = (events ?? []).filter((e) => e.type === "risk_completed");
  const total = run.risks ? run.risks.split(",").filter((r) => r.trim()).length : 0;
  const progress = { completed: completedHere.length, total };

  if (completedHere.some(mine)) return { ...progress, phase: "done" };
  if ((events ?? []).some((e) => e.type === "risk_started" && mine(e))) {
    return { ...progress, phase: "running" };
  }
  return { ...progress, phase: "queued" };
}
