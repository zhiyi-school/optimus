import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { RunSyncStatus } from "@/api/automation-types";
import { canRetrySync, dashboardSyncPresentation, syncCountsSummary } from "@/lib/dashboard-sync";
import { cn } from "@/lib/utils";

export function DashboardSyncNotice({
  sync,
  onRetry,
  retrying = false,
  retryError,
  className,
}: {
  sync: RunSyncStatus | null | undefined;
  onRetry?: () => void;
  retrying?: boolean;
  retryError?: string | null;
  className?: string;
}) {
  if (!sync) return null;
  const { label, tone, detail } = dashboardSyncPresentation(sync.status);
  const counts = syncCountsSummary(sync);

  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        sync.status === "failed" ? "border-danger/40 bg-danger/5" : "border-border bg-muted/30",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone}>{label}</Badge>
        {sync.attempt > 1 && (
          <span className="text-xs text-muted-foreground">Attempt {sync.attempt}</span>
        )}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{counts ?? detail}</p>
      {sync.error && sync.status === "failed" && (
        <p className="mt-1.5 break-words text-xs text-danger">{sync.error}</p>
      )}
      {retryError && <p className="mt-1.5 text-xs text-danger">{retryError}</p>}
      {canRetrySync(sync) && onRetry && (
        <Button size="sm" variant="outline" className="mt-3" disabled={retrying} onClick={onRetry}>
          {retrying ? "Retrying…" : "Retry dashboard sync"}
        </Button>
      )}
    </div>
  );
}
