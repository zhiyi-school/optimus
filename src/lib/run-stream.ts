/**
 * Display helpers for a run's live event stream.
 */

import type { RunEventStreamState } from "@/lib/run-event-types";

/** Label for the live event stream's state; it says nothing about any caller's polling. */
export function streamStateLabel(streamState: RunEventStreamState) {
  if (streamState === "unavailable") return "Live updates unavailable";
  return streamState === "open" ? "Streaming" : "Connecting";
}
