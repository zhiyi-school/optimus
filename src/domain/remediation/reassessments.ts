/**
 * Queue order of a risk's reassessment requests and who may withdraw one.
 */

import type { RetestRun, Ticket } from "@/database/types";

/** Deterministic queue order: oldest first, id breaking a tie. */
function byQueueOrder(a: RetestRun, b: RetestRun): number {
  const left = a.created_at ?? "";
  const right = b.created_at ?? "";
  return left === right ? a.id.localeCompare(b.id) : left.localeCompare(right);
}

/** The reassessment currently running, if any. */
export function runningReassessment(retests: RetestRun[] | undefined): RetestRun | undefined {
  return (retests ?? []).find((retest) => retest.status === "running");
}

/** Queued reassessments in queue order. */
export function queuedReassessments(retests: RetestRun[] | undefined): RetestRun[] {
  return (retests ?? []).filter((retest) => retest.status === "queued").sort(byQueueOrder);
}

/** The queued reassessment security may start next, or none while one is running. */
export function nextReassessment(retests: RetestRun[] | undefined): RetestRun | undefined {
  return runningReassessment(retests) ? undefined : queuedReassessments(retests)[0];
}

/** Queued and running reassessments in queue order. */
export function outstandingReassessments(retests: RetestRun[] | undefined): RetestRun[] {
  return (retests ?? [])
    .filter((retest) => retest.status === "queued" || retest.status === "running")
    .sort(byQueueOrder);
}

/** True when the requester may withdraw their queued request while its remediation still awaits it. */
export function canWithdrawReassessment(
  retest: RetestRun | null | undefined,
  ticket: Ticket | null | undefined,
  profileId: string | null | undefined,
): boolean {
  if (!retest || retest.status !== "queued") return false;
  if (!profileId || retest.requested_by !== profileId) return false;
  if (!ticket || ticket.type !== "remediation") return false;
  if (retest.ticket_id !== ticket.id) return false;
  return ticket.status === "retest_requested";
}
