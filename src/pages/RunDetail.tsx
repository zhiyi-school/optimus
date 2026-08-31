import { useParams } from "react-router-dom";
import { PageHeader, LoadingState, ErrorState, EmptyState } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { PlatformBadge, StatusBadge, TestRunStatusBadge } from "@/components/data-display";
import { RunEventTimeline } from "@/components/run-events";
import { DashboardSyncNotice } from "@/components/dashboard-sync-notice";
import { DownloadSarifButton } from "@/components/download-sarif-button";
import { canExportSarif } from "@/lib/sarif";
import {
  useRunEvents,
  useRunStatus,
  useRunResults,
  useRunSyncStatus,
  useResyncRun,
} from "@/hooks/queries";
import { mapVerdictToFindingStatus } from "@/data/sync";
import { errorMessage, formatDate, formatDuration } from "@/lib/utils";

export default function RunDetail() {
  const { runTimestamp: runId } = useParams<{ runTimestamp: string }>();
  const { data: run, isLoading, isError, refetch } = useRunStatus(runId, { poll: true });
  const { data: sync } = useRunSyncStatus(run?.run_id ?? runId);
  const resync = useResyncRun(run?.run_id ?? runId);

  const inProgress = run?.status === "running";
  const { events, streamState } = useRunEvents(run?.run_id ?? runId, !!inProgress);
  const {
    data: results,
    isLoading: resultsLoading,
    isError: resultsError,
    refetch: refetchResults,
  } = useRunResults(run?.run_timestamp ?? runId, !inProgress);

  if (isLoading) return <LoadingState label="Loading run…" />;
  if (isError || !run) return <ErrorState message="Unable to load this run." onRetry={() => refetch()} />;

  return (
    <div>
      <PageHeader
        title={run.run_timestamp}
        description={run.config_path}
        actions={
          <div className="flex items-center gap-2">
            <PlatformBadge platform={run.platform} />
            <TestRunStatusBadge status={run.status} />
            <DownloadSarifButton runTimestamp={run.run_timestamp ?? runId} available={canExportSarif(run)} />
          </div>
        }
      />

      <Card className="mb-6">
        <CardContent className="grid grid-cols-2 gap-4 py-4 sm:grid-cols-4">
          <Field label="Started" value={formatDate(run.started_at)} />
          <Field label="Completed" value={formatDate(run.completed_at)} />
          <Field
            label="Tests Completed"
            value={resultsLoading ? "…" : String(results?.length ?? 0)}
          />
          <Field label="Run ID" value={run.run_id} />
        </CardContent>
      </Card>

      {run.error && (
        <div className="mb-6">
          <ErrorState message={run.error} />
        </div>
      )}

      <DashboardSyncNotice
        className="mb-6"
        sync={sync}
        onRetry={() => resync.mutate()}
        retrying={resync.isPending}
        retryError={resync.isError ? errorMessage(resync.error, "Could not start the sync.") : null}
      />

      {inProgress && (
        <div className="space-y-4">
          <RunEventTimeline events={events} streamState={streamState} />
          <EmptyState
            title="Run in progress…"
            description="This page streams live events when available and keeps polling as a fallback. Results will appear here once the run completes."
          />
        </div>
      )}

      {!inProgress && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-foreground">Results</h2>
          {resultsLoading && <LoadingState label="Loading results…" />}
          {resultsError && (
            <ErrorState message="Unable to load results for this run." onRetry={() => refetchResults()} />
          )}
          {!resultsLoading && !resultsError && (results ?? []).length === 0 && (
            <EmptyState title="No results were recorded for this run." />
          )}
          {!resultsLoading && (results ?? []).length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <table className="w-full border-collapse text-sm">
                <thead className="border-b border-border">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Application
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Test
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Duration
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Result
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(results ?? []).map((row) => (
                    <tr key={`${row.app_id}-${row.test_id}`}>
                      <td className="px-3 py-2.5 text-foreground">{row.app_name}</td>
                      <td className="px-3 py-2.5 text-foreground">{row.test_name}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {formatDuration(row.duration_seconds)}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge status={mapVerdictToFindingStatus(row.verdict)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate font-medium text-foreground">{value}</p>
    </div>
  );
}
