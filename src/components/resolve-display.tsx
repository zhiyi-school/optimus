import { RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toneClasses, type Tone } from "@/lib/status";
import type { Progress } from "@/lib/resolve";

export function PlaybookUpdatedNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
      <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <p className="flex-1 text-sm text-foreground">
        Remediation instructions were updated. You are viewing the latest steps.
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss the update notice"
        className="shrink-0 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

const barTone: Record<Tone, string> = {
  danger: "bg-danger",
  success: "bg-success",
  warning: "bg-warning",
  neutral: "bg-muted-foreground",
  info: "bg-primary",
};

export function ToneBadge({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        toneClasses[tone],
      )}
    >
      {label}
    </span>
  );
}

export function ProgressBar({
  label,
  progress,
  tone = "info",
}: {
  label: string;
  progress: Progress;
  tone?: Tone;
}) {
  const percent = Math.round(progress.ratio * 100);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="text-xs text-muted-foreground">
          {progress.total === 0 ? "—" : `${progress.completed} of ${progress.total}`}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div
          className={cn("h-full rounded-full transition-all", barTone[tone])}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
