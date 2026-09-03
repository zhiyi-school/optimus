import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Plus, RefreshCw, SlidersHorizontal, Trash2 } from "lucide-react";
import { PageHeader, FilterBar, LoadingState, ErrorState, EmptyState } from "@/components/common";
import { DataTable, type DataTableColumn, AssessmentStatusBadge } from "@/components/data-display";
import { AssessmentStatusPanel } from "@/components/assessment-progress";
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
  useDeleteApplication,
} from "@/hooks/queries";
import { useAuth } from "@/auth/useAuth";
import { ApplicationIcon } from "@/components/application-icon";
import { latestAssessmentPerApp } from "@/lib/assessments";
import { cn, compareByName, errorMessage, formatDate } from "@/lib/utils";
import type { Assessment, Application } from "@/data/types";

/** Setup, waiting, and pre-completion failure all expose status through the row's dropdown only. */
const INCOMPLETE_STATUSES = ["queued", "waiting", "running", "failed"];

type Row = Assessment & { application: Application | null };

export default function Assessments() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [appToDelete, setAppToDelete] = useState<Application | null>(null);

  const { data: assessments, isLoading, isFetching, isError, refetch } = useAssessments();
  const { data: applications } = useApplications();
  const sortedApplications = useMemo(
    () => [...(applications ?? [])].sort((a, b) => compareByName(a.name, b.name, a.id, b.id)),
    [applications],
  );

  // The one URL-held expansion state: set by clicking a row here, or by a
  // redirect from a direct link to an incomplete assessment (AssessmentDetail).
  const expandedId = params.get("expanded");
  const toggleExpand = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params);
      if (next.get("expanded") === id) next.delete("expanded");
      else next.set("expanded", id);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const {
    data: reports,
    isError: reportsError,
    error: reportsErrorDetail,
  } = useAutomationReports();
  const deleteApp = useDeleteApplication();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const canRunTest = can("run_test");

  const platformFilter = params.get("platform") ?? "";
  const statusFilter = params.get("status") ?? "";
  const appFilter = params.get("application") ?? "";
  const activeFilters = [platformFilter, statusFilter, appFilter].filter(Boolean).length;
  const [filtersOpen, setFiltersOpen] = useState(activeFilters > 0);

  const setParam = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }, [params, setParams]);

  const rows = useMemo(() => {
    let list = latestAssessmentPerApp(assessments);
    if (platformFilter) list = list.filter((a) => a.application?.platform === platformFilter);
    if (statusFilter) list = list.filter((a) => a.status === statusFilter);
    if (appFilter) list = list.filter((a) => a.application_id === appFilter);
    return list;
  }, [assessments, platformFilter, statusFilter, appFilter]);

  // A bookmarked or stale id shouldn't linger in the URL once the data that
  // would justify it has loaded.
  useEffect(() => {
    if (!expandedId || isLoading) return;
    if (!rows.some((r) => r.id === expandedId)) toggleExpand(expandedId);
  }, [expandedId, isLoading, rows, toggleExpand]);

  const awaitingSync = useMemo(
    () =>
      (reports ?? []).filter(
        (runTimestamp) =>
          !(assessments ?? []).some((a) => a.external_id.startsWith(`${runTimestamp}::`)),
      ),
    [reports, assessments],
  );

  const confirmDelete = useCallback(async () => {
    if (!appToDelete) return;
    setDeleteError(null);
    try {
      await deleteApp.mutateAsync({ applicationId: appToDelete.id, applicationName: appToDelete.name });
      setAppToDelete(null);
    } catch (err) {
      setDeleteError(errorMessage(err, "Unable to delete this app."));
    }
  }, [appToDelete, deleteApp]);

  const columns: DataTableColumn<Row>[] = useMemo(
    () => [
      {
        key: "application",
        header: "Application",
        render: (r) => (
          <div className="flex items-center gap-3">
            <ApplicationIcon application={r.application} />
            <span className="font-medium text-foreground">{r.application?.name ?? "—"}</span>
          </div>
        ),
      },
      { key: "version", header: "Version", render: (r) => r.application?.version ?? "—" },
      {
        key: "progress",
        header: "Progress",
        render: (r) => (
          <div className="w-40">
            <p className="mb-1 text-xs font-medium text-primary">
              {r.completed_tests} of {r.total_tests}
            </p>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label={`${r.application?.name ?? "Application"} security tests completed`}
              aria-valuemin={0}
              aria-valuemax={r.total_tests}
              aria-valuenow={r.completed_tests}
            >
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  r.total_tests > 0 && r.completed_tests >= r.total_tests
                    ? "bg-success"
                    : "bg-primary",
                )}
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
      ...(canRunTest
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
    ],
    [canRunTest],
  );

  return (
    <div>
      <PageHeader
        title="Assessments"
        description="Select an application assessment to continue."
        actions={
          canRunTest && (
            <>
              <Link to="/assessments/new">
                <Button size="sm" variant="outline" className="border-primary text-primary hover:bg-primary/5">
                  <Plus className="h-3.5 w-3.5" />
                  New Assessment
                </Button>
              </Link>
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
            </>
          )
        }
      />

      {(reportsError || awaitingSync.length > 0) && (
        <p className="mb-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span>
            {reportsError
              ? `Can't reach the automation backend (${
                  reportsErrorDetail instanceof Error ? reportsErrorDetail.message : "network error"
                }). Check VITE_API_BASE_URL and its CORS origins — see docs/AUTOMATION_API.md.`
              : `${awaitingSync.length} completed run${
                  awaitingSync.length > 1 ? "s have" : " has"
                } not appeared here yet. The automation host syncs them on its own schedule.`}
          </span>
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filters
          {activeFilters > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
              {activeFilters}
            </span>
          )}
        </button>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {rows.length === 1 ? "1 assessment" : `${rows.length} assessments`}
          {isFetching && !isLoading && (
            <RefreshCw
              aria-label="Refreshing"
              className="h-3 w-3 animate-spin text-muted-foreground/70 motion-reduce:animate-none"
            />
          )}
        </span>
      </div>

      {filtersOpen && (
        <FilterBar>
          <Select value={appFilter} onChange={(e) => setParam("application", e.target.value)}>
            <option value="">All applications</option>
            {sortedApplications.map((app) => (
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
            <option value="waiting">Waiting to start</option>
            <option value="running">Assessing in progress</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </Select>
        </FilterBar>
      )}

      {isLoading && <LoadingState label="Loading assessments…" />}
      {isError && <ErrorState message="Unable to load assessments." onRetry={() => refetch()} />}
      {!isLoading && !isError && rows.length === 0 && (
        <EmptyState
          title="No assessments are currently available."
          description={
            canRunTest
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
          rowLabel={(r) => `Open the assessment for ${r.application?.name ?? "this application"}`}
          rowActivation={(r) => (r.status === "completed" ? "navigate" : "expand")}
          expandLabel={(r) =>
            `View setup and testing status for ${r.application?.name ?? "this application"}`
          }
          renderCard={(r) => (
            <span className="flex items-center gap-3">
              <ApplicationIcon application={r.application} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {r.application?.name ?? "—"}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {r.application?.version ? `Version ${r.application.version}` : "Version unknown"} ·{" "}
                  {r.completed_tests} of {r.total_tests} tests
                </span>
                <span className="mt-1 block">
                  <AssessmentStatusBadge status={r.status} />
                </span>
              </span>
            </span>
          )}
          expandedRowId={expandedId}
          onToggleExpand={(r) => toggleExpand(r.id)}
          renderExpanded={(r) =>
            INCOMPLETE_STATUSES.includes(r.status) ? (
              <AssessmentStatusPanel assessment={r} canRetry={canRunTest} />
            ) : null
          }
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
