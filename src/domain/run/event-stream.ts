/**
 * Connection states of a run's live event stream and how they are labelled.
 */

export type RunEventStreamState =
  | "idle"
  | "connecting"
  | "open"
  | "unavailable"
  | "closed";

/** Label for the live event stream's state; it says nothing about any caller's polling. */
export function streamStateLabel(streamState: RunEventStreamState) {
  if (streamState === "unavailable") return "Live updates unavailable";
  return streamState === "open" ? "Streaming" : "Connecting";
}
