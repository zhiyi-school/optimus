import { assessmentApi, defaultConfigPath } from "@/api/automation-services";
import type {
  AutomationPlatform,
  RunProgressEvent,
  RunRecord,
  StartRunRequest,
} from "@/api/automation-types";
import { assessmentData } from "@/data/services";
import type { RunCancelToken } from "./mapping";

const RUN_POLL_INTERVAL_MS = 3000;
const RUN_POLL_MAX_ATTEMPTS = 120;

/** `cancelledWaiting`/`timedOutWaiting` mean this browser stopped watching, not that the run stopped. */
export type RunOutcome = "completed" | "failed" | "cancelledWaiting" | "timedOutWaiting";

export interface RunWaitResult {
  run: RunRecord;
  outcome: RunOutcome;
  dashboardSyncPending: boolean;
}

export async function runAndWait(
  payload: StartRunRequest,
  onStarted?: (run: RunRecord) => unknown,
  cancelToken?: RunCancelToken,
): Promise<RunWaitResult> {
  const started = await assessmentApi.startRun(payload);
  if (onStarted) await onStarted(started);

  let latest = started;
  let attempts = 0;

  while (latest.status === "running" && attempts < RUN_POLL_MAX_ATTEMPTS) {
    if (cancelToken?.cancelled) {
      return { run: latest, outcome: "cancelledWaiting", dashboardSyncPending: false };
    }
    await new Promise((resolve) => setTimeout(resolve, RUN_POLL_INTERVAL_MS));
    latest = await assessmentApi.getRun(started.run_id);
    attempts += 1;
  }

  if (latest.status === "completed") {
    return { run: latest, outcome: "completed", dashboardSyncPending: true };
  }
  if (latest.status === "failed") {
    return { run: latest, outcome: "failed", dashboardSyncPending: false };
  }
  return { run: latest, outcome: "timedOutWaiting", dashboardSyncPending: false };
}

export interface ActiveRunFilter {
  platform: AutomationPlatform | undefined;
  appExternalId: string | undefined;
  riskId?: string;
}

function normalizeAppSelector(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function selectionCovers(csv: string | null | undefined, wanted: string, appSelector: boolean): boolean {
  if (!csv) return true;
  const target = appSelector ? normalizeAppSelector(wanted) : wanted.trim();
  return csv
    .split(",")
    .map((item) => (appSelector ? normalizeAppSelector(item) : item.trim()))
    .filter(Boolean)
    .includes(target);
}

/**
 * Finds the run still executing on the automation host that covers this app (and
 * risk), so a page that was unmounted mid-run can pick the progress back up.
 */
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

/** Any run occupying the platform's single device, whichever app or risk it is for. */
export function findPlatformRun(
  runs: RunRecord[] | undefined,
  platform: AutomationPlatform | undefined,
): RunRecord | undefined {
  if (!platform) return undefined;
  return runs?.find((run) => run.status === "running" && run.platform === platform);
}

/**
 * Where one risk stands inside a run. The device runs risks strictly one at a
 * time, so a run covering four risks has three of them merely waiting.
 */
export type RiskRunPhase = "queued" | "running" | "done";

export interface RiskRunProgress {
  phase: RiskRunPhase;
  /** Risks of this run that have finished, and how many it set out to cover. */
  completed: number;
  total: number;
}

export function riskProgressInRun(
  events: RunProgressEvent[] | undefined,
  run: RunRecord | undefined,
  appExternalId: string | undefined,
  riskId: string | undefined,
): RiskRunProgress | undefined {
  if (!run || !appExternalId || !riskId) return undefined;

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

export async function runAllTests(input: {
  assessmentId: string;
  platform: AutomationPlatform;
  appExternalId: string;
  riskIds?: string[];
  triggeredBy?: string | null;
}): Promise<RunOutcome | "notClaimed"> {
  const claimed = await assessmentData.claimForRun(input.assessmentId);
  if (!claimed) return "notClaimed";

  try {
    const { outcome } = await runAndWait({
      platform: input.platform,
      config_path: defaultConfigPath(input.platform),
      apps: input.appExternalId,
      ...(input.riskIds?.length ? { risks: input.riskIds.join(",") } : {}),
    });
    // Giving up on watching says nothing about whether the run is still executing.
    if (outcome === "failed") {
      await assessmentData.setStatus(input.assessmentId, "failed");
    }
    return outcome;
  } catch (err) {
    const busy = (err as { status?: number } | null)?.status === 409;
    await assessmentData
      .setStatus(input.assessmentId, busy ? "queued" : "failed")
      .catch((releaseErr) => console.warn("Could not release the assessment claim.", releaseErr));
    throw err;
  }
}
