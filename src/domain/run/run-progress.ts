/**
 * Progress of a run derived from its live event stream.
 */

import type { RunProgressEvent } from "@/automation-api/types";

/** Counts the distinct tests a run has finished for one app, from its `risk_completed` events. */
export function countCompletedTests(events: RunProgressEvent[], appExternalId: string | null | undefined): number {
  const finished = new Set<string>();
  for (const event of events) {
    if (event.type !== "risk_completed" || !event.risk_id) continue;
    if (appExternalId && event.app_id && event.app_id !== appExternalId) continue;
    finished.add(event.risk_id);
  }
  return finished.size;
}
