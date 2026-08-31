import type { RunEventStreamState } from "@/hooks/queries";

/** Describes only what the stream is doing; it makes no claim about any caller's polling. */
export function streamStateLabel(streamState: RunEventStreamState) {
  if (streamState === "unavailable") return "Live updates unavailable";
  return streamState === "open" ? "Streaming" : "Connecting";
}
