import type { DashboardSyncStatus, RunSyncStatus } from "@/api/automation-types";
import type { Tone } from "@/lib/status";

export const SYNC_STATUS_POLL_INTERVAL_MS = 4000;

const PRESENTATION: Record<DashboardSyncStatus, { label: string; tone: Tone; detail: string }> = {
  queued: {
    label: "Dashboard sync queued",
    tone: "info",
    detail: "The run finished. Its results are waiting to be written to the dashboard.",
  },
  running: {
    label: "Dashboard sync in progress",
    tone: "info",
    detail: "Writing this run's results to the dashboard.",
  },
  completed: {
    label: "Dashboard updated",
    tone: "success",
    detail: "This run's results are in the dashboard.",
  },
  failed: {
    label: "Dashboard sync failed",
    tone: "danger",
    detail:
      "The run itself is intact and its results are below — only the dashboard copy is missing.",
  },
  not_required: {
    label: "Dashboard sync not required",
    tone: "neutral",
    detail: "This run has nothing to publish to the dashboard.",
  },
};

export function dashboardSyncPresentation(status: DashboardSyncStatus) {
  return PRESENTATION[status];
}

/** The run and its dashboard sync are separate workflows; only the sync is still moving here. */
export function isSyncPending(status: DashboardSyncStatus | undefined): boolean {
  return status === "queued" || status === "running";
}

export function syncPollInterval(status: DashboardSyncStatus | undefined): number | false {
  return isSyncPending(status) ? SYNC_STATUS_POLL_INTERVAL_MS : false;
}

export function canRetrySync(sync: RunSyncStatus | null | undefined): boolean {
  return sync?.status === "failed" && sync.retryable === true;
}

export function syncCountsSummary(sync: RunSyncStatus | null | undefined): string | null {
  if (!sync || sync.status !== "completed") return null;
  const { findings, history, activity } = sync.counts;
  if (findings === 0 && history === 0 && activity === 0) return null;
  const parts = [plural(findings, "finding")];
  if (history > 0) parts.push(plural(history, "status change"));
  if (activity > 0) parts.push(plural(activity, "activity entry", "activity entries"));
  return `${parts.join(", ")} recorded.`;
}

function plural(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}
