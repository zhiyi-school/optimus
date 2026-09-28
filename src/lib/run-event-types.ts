/**
 * Connection states of a run's live event stream.
 */

export type RunEventStreamState =
  | "idle"
  | "connecting"
  | "open"
  | "unavailable"
  | "closed";
