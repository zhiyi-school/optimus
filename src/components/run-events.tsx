import { CheckCircle2, Circle, Radio, WifiOff, XCircle } from "lucide-react";
import type { RunProgressEvent } from "@/api/automation-types";
import type { RunEventStreamState } from "@/hooks/queries";
import { streamStateLabel } from "@/lib/run-stream";
import { cn, formatDate } from "@/lib/utils";

function eventLabel(event: RunProgressEvent): string {
  if (event.message && typeof event.message === "string") return event.message;
  if (event.type === "risk_started") {
    return `Started ${event.risk_id ?? "risk"} for ${event.app_id ?? "app"}.`;
  }
  if (event.type === "risk_completed") {
    return `Completed ${event.risk_id ?? "risk"} with ${event.verdict ?? event.final_status ?? "a result"}.`;
  }
  if (event.type === "done") {
    return event.status === "failed"
      ? `Run failed${event.error ? `: ${event.error}` : "."}`
      : `Run finished with status ${event.status ?? "completed"}.`;
  }
  return event.type.replaceAll("_", " ");
}

function iconFor(event: RunProgressEvent) {
  if (event.type === "risk_completed" || (event.type === "done" && event.status === "completed")) {
    return CheckCircle2;
  }
  if (event.type === "done" && event.status === "failed") return XCircle;
  if (event.type === "appium_recovery") return Radio;
  return Circle;
}

export function RunEventTimeline({
  events,
  streamState,
  emptyLabel = "Waiting for live events…",
}: {
  events: RunProgressEvent[];
  streamState: RunEventStreamState;
  emptyLabel?: string;
}) {
  const liveUpdatesUnavailable = streamState === "unavailable";

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-muted-foreground">Live Events</p>
        <span
          className={cn(
            "inline-flex items-center gap-1 text-xs",
            liveUpdatesUnavailable ? "text-warning" : "text-muted-foreground",
          )}
        >
          {liveUpdatesUnavailable && <WifiOff className="h-3.5 w-3.5" />}
          {streamStateLabel(streamState)}
        </span>
      </div>
      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ol className="space-y-2">
          {events.map((event, index) => {
            const Icon = iconFor(event);
            return (
              <li key={`${event.timestamp ?? "event"}-${event.type}-${index}`} className="flex gap-2">
                <Icon
                  className={cn(
                    "mt-0.5 h-3.5 w-3.5 shrink-0",
                    event.type === "done" && event.status === "failed"
                      ? "text-danger"
                      : event.type === "risk_completed" || event.status === "completed"
                        ? "text-success"
                        : "text-primary",
                  )}
                />
                <div className="min-w-0">
                  <p className="text-xs text-foreground">{eventLabel(event)}</p>
                  {event.timestamp && (
                    <p className="text-[11px] text-muted-foreground">{formatDate(event.timestamp)}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
