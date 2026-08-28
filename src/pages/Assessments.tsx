import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { PageHeader, FilterBar, LoadingState, ErrorState, EmptyState } from "@/components/common";
import { DataTable, type DataTableColumn, AssessmentStatusBadge } from "@/components/data-display";
import { EnvironmentSetupStages } from "@/components/assessment-progress";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useAssessments,
  useApplications,
  useAutomationReports,
  useAutomationRuns,
  useDeleteApplication,
  useSyncReport,
} from "@/hooks/queries";
import { useAuth } from "@/auth/useAuth";
import { appTypeIcon } from "@/lib/entity-icons";
import { latestAssessmentPerApp } from "@/lib/assessments";
import { errorMessage, formatDate } from "@/lib/utils";
import type { Assessment, Application } from "@/data/types";

type Row = Assessment & { application: Application | null };

export default function Assessments() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { profile, can } = useAuth();
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [appToDelete, setAppToDelete] = useState<Application | null>(null);

  const { data: assessments, isLoading, isError, refetch } = useAssessments();
  const { data: applications } = useApplications();
  const {
    data: reports,
    isError: reportsError,
    error: reportsErrorDetail,
  } = useAutomationReports();
  const { data: runs } = useAutomationRuns();
  const sync = useSyncReport();
  const syncReport = sync.mutateAsync;
  const deleteApp = useDeleteApplication();
  const syncingRef = useRef<Set<string>>(new Set());
  const [syncError, setSyncError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const platformFilter = params.get("platform") ?? "";
  const statusFilter = params.get("status") ?? "";
  const appFilter = params.get("application") ?? "";

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const rows = useMemo(() => {
    let list = latestAssessmentPerApp(assessments);
    if (platformFilter) list = list.filter((a) => a.application?.platform === platformFilter);
    if (statusFilter) list = list.filter((a) => a.status === statusFilter);
    if (appFilter) list = list.filter((a) => a.application_id === appFilter);
    return list;
  }, [assessments, platformFilter, statusFilter, appFilter]);

  const unsyncedReports = useMemo(
    () =>
      (reports ?? []).filter(
        (runTimestamp) =>
          !(assessments ?? []).some((a) => a.external_id.startsWith(`${runTimestamp}::`)),
      ),
    [reports, assessments],
  );

  async function syncAll() {
    setSyncError(null);
    try {
      for (const runTimestamp of unsyncedReports) {
        await sync.mutateAsync({ runTimestamp, triggeredBy: profile?.id ?? null });
      }
      refetch();
    } catch (err) {
      setSyncError(errorMessage(err, "Unable to sync one or more reports."));
    }
  }

  async function confirmDelete() {
    if (!appToDelete) return;
    setDeleteError(null);
    try {
      await deleteApp.mutateAsync({ applicationId: appToDelete.id, applicationName: appToDelete.name });
      setAppToDelete(null);
    } catch (err) {
      setDeleteError(errorMessage(err, "Unable to delete this app."));
    }
  }

  useEffect(() => {
    if (!can("run_test")) return;
    for (const run of runs ?? []) {
      if (run.status !== "completed") continue;
      if (syncingRef.current.has(run.run_timestamp)) continue;
      const alreadySynced = (assessments ?? []).some((a) =>
        a.external_id.startsWith(`${run.run_timestamp}::`),
      );
      if (alreadySynced) continue;

      syncingRef.current.add(run.run_timestamp);
      syncReport({ runTimestamp: run.run_timestamp, triggeredBy: profile?.id ?? null }).catch(
        (err) => {
          console.warn(`Auto-sync failed for run ${run.run_timestamp}`, err);
          syncingRef.current.delete(run.run_timestamp);
        },
      );
    }
  }, [runs, assessments, can, syncReport, profile?.id]);

  const columns: DataTableColumn<Row>[] = [
    {
      key: "application",
      header: "Application",
      render: (r) => {
        const Icon = appTypeIcon(r.application?.app_type);
        return (
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/40">
              <Icon className="h-4 w-4 text-foreground" />
            </div>
            <span className="font-medium text-foreground">{r.application?.name ?? "—"}</span>
          </div>
        );
      },
    },
    { key: "version", header: "Version", render: (r) => r.application?.version ?? "—" },
    {
      key: "progress",
      header: "Progress",
      render: (r) => (
        <div>
          <p className="mb-1 text-xs font-medium text-foreground">
            {r.completed_tests} of {r.total_tests}
          </p>
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{
                width: `${r.total_tests > 0 ? Math.min(100, Math.round((r.completed_tests / r.total_tests) * 100)) : 0}%`,
              }}
            />
          </div>
        </div>
      ),
    },
    { key: "status", header: "Status", render: (r) => <AssessmentStatusBadge status={r.status} /> },
    { key: "created", header: "Created At", render: (r) => formatDate(r.created_at) },
    ...(can("run_test")
      ? [
          {
            key: "actions",
            header: "",
            render: (r: Row) =>
              r.application && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAppToDelete(r.application);
                  }}
                  className="text-muted-foreground hover:text-danger"
                  title={`Delete ${r.application.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title="Assessments"
        description="Select an application assessment to continue."
        actions={
          can("run_test") && (
            <>
              <Link to="/assessments/new">
                <Button size="sm" variant="outline" className="border-primary text-primary hover:bg-primary/5">
                  <Plus className="h-3.5 w-3.5" />
                  New Assessment
                </Button>
              </Link>
              {unsyncedReports.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => void syncAll()} disabled={sync.isPending}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Sync {unsyncedReports.length} report{unsyncedReports.length > 1 ? "s" : ""}
                </Button>
              )}
            </>
          )
        }
      />

      {reportsError && (
        <ErrorState
          message={`Unable to reach the automation backend (${
            reportsErrorDetail instanceof Error ? reportsErrorDetail.message : "network error"
          }). Check VITE_API_BASE_URL and that the backend allows requests from this origin (CORS) — see docs/AUTOMATION_API.md.`}
        />
      )}

      {syncError && (
        <ErrorState message={`Sync failed: ${syncError}`} onRetry={() => void syncAll()} />
      )}

      <FilterBar>
        <Select value={appFilter} onChange={(e) => setParam("application", e.target.value)}>
          <option value="">All applications</option>
          {(applications ?? []).map((app) => (
            <option key={app.id} value={app.id}>
              {app.name}
            </option>
          ))}
        </Select>
        <Select value={platformFilter} onChange={(e) => setParam("platform", e.target.value)}>
          <option value="">All platforms</option>
          <option value="ios">iOS</option>
          <option value="android">Android</option>
        </Select>
        <Select value={statusFilter} onChange={(e) => setParam("status", e.target.value)}>
          <option value="">All statuses</option>
          <option value="queued">Queued</option>
          <option value="running">Assessing in progress</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </Select>
      </FilterBar>

      {isLoading && <LoadingState label="Loading assessments…" />}
      {isError && <ErrorState message="Unable to load assessments." onRetry={() => refetch()} />}
      {!isLoading && !isError && rows.length === 0 && (
        <EmptyState
          title="No assessments are currently available."
          description={
            can("run_test")
              ? "Add an app, or sync existing automation reports, to populate this page."
              : "The Security Team has not run any assessments yet."
          }
        />
      )}
      {!isLoading && rows.length > 0 && (
        <DataTable
          columns={columns}
          rows={rows}
          onRowClick={(r) => navigate(`/assessments/${r.id}`)}
          expandedRowId={expandedRowId}
          onToggleExpand={(r) => setExpandedRowId((current) => (current === r.id ? null : r.id))}
          renderExpanded={(r) => {
            if (r.status !== "queued" && r.status !== "running") return null;
            const ready = r.application?.provisioning_status === "ready";
            return (
              <div>
                <p className="mb-3 text-sm text-foreground">
                  {r.status === "running"
                    ? "Tests are running. You can safely leave this page and we'll notify you when it's complete."
                    : ready
                      ? "Setup is complete. Security tests can be run against this app."
                      : "This assessment is still being set up — the app has to be prepared for testing before any security test can run against it."}
                </p>
                <p className="mb-2 text-sm font-semibold text-foreground">Activities</p>
                <EnvironmentSetupStages ready={ready} assessment={r} />
              </div>
            );
          }}
        />
      )}

      <Dialog open={!!appToDelete} onOpenChange={(open) => !open && setAppToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {appToDelete?.name}?</DialogTitle>
            <DialogDescription>
              This permanently deletes the application along with every assessment, finding, and
              ticket (and their messages/history) tied to it. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteError && <p className="text-xs text-danger">{deleteError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAppToDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleteApp.isPending} onClick={() => void confirmDelete()}>
              {deleteApp.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
