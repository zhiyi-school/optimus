/**
 * Presentation and polling rules for a run's dashboard sync status.
 */

import type { DashboardSyncStatus, RunSyncStatus } from "@/automation-api/types";
import type { Tone } from "@/lib/status";

export const SYNC_STATUS_POLL_INTERVAL_MS = 4000;
/** Bounds the wait for a record that never appears, so a backend without the endpoint stops. */
export const SYNC_STATUS_POLL_MAX_ATTEMPTS = 15;

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

/** Label, tone and explanation for a dashboard sync status. */
export function dashboardSyncPresentation(status: DashboardSyncStatus) {
  return PRESENTATION[status];
}

/** True while the dashboard sync, a workflow separate from the run, is queued or running. */
export function isSyncPending(status: DashboardSyncStatus | undefined): boolean {
  return status === "queued" || status === "running";
}

/** Poll interval while the sync is pending or not yet recorded (up to the attempt cap); otherwise false. */
export function syncPollInterval(
  status: DashboardSyncStatus | undefined,
  attempts = 0,
): number | false {
  if (isSyncPending(status)) return SYNC_STATUS_POLL_INTERVAL_MS;
  if (status === undefined && attempts < SYNC_STATUS_POLL_MAX_ATTEMPTS) {
    return SYNC_STATUS_POLL_INTERVAL_MS;
  }
  return false;
}

/** True when the sync failed and the backend marked it retryable. */
export function canRetrySync(sync: RunSyncStatus | null | undefined): boolean {
  return sync?.status === "failed" && sync.retryable === true;
}

/** A sentence counting what a completed sync recorded, or null when it recorded nothing. */
export function syncCountsSummary(sync: RunSyncStatus | null | undefined): string | null {
  if (!sync || sync.status !== "completed") return null;
  const { findings, history, activity } = sync.counts;
  if (findings === 0 && history === 0 && activity === 0) return null;
  const parts = [plural(findings, "finding")];
  if (history > 0) parts.push(plural(history, "status change"));
  if (activity > 0) parts.push(plural(activity, "activity entry", "activity entries"));
  return `${parts.join(", ")} recorded.`;
}

/** Formats a count with the singular or plural noun. */
function plural(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}
