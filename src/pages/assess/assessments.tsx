/**
 * Security Assessments list with filters, expandable status panels and app deletion.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, PackagePlus, Plus, RefreshCw, SlidersHorizontal, Trash2 } from "lucide-react";
import { PageHeader, FilterBar, LoadingState, ErrorState, EmptyState } from "@/components/layout/page-blocks";
import {
  DataTable,
  type DataTableColumn,
  AssessmentStatusBadge,
  PlatformBadge,
} from "@/components/shared/badges-and-table";
import { AssessmentStatusPanel } from "@/components/assessment/assessment-progress";
import { NewVersionDialog } from "@/components/assessment/new-version-dialog";
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
} from "@/hooks/queries/assessments";
import {
  useAutomationReports,
} from "@/hooks/queries/automation";
import { useConversationActivity } from "@/hooks/queries/conversations";
import {
  useApplications,
  useDeleteApplication,
} from "@/hooks/queries/reference";
import { useAuth } from "@/auth/auth-context";
import { ApplicationIcon } from "@/components/shared/application-icon";
import { latestAssessmentPerApp } from "@/domain/assessment/assessments";
import { assessmentVersion, canStartNewAssessment } from "@/domain/assessment/build-versions";
import { applicationLabel } from "@/domain/status-labels";
import { createDebug } from "@/lib/debug";
import { cn, compareByName, errorMessage, formatDate } from "@/lib/utils";
import type { Assessment, Application } from "@/database/types";

const debug = createDebug("pages:assess:assessments");

/** How many failed runs the sync warning links to before summarising the rest. */
const UNSYNCED_RUN_LINKS = 3;

/** Statuses whose row expands to a status panel instead of opening the assessment. */
const INCOMPLETE_STATUSES = ["queued", "waiting", "running", "failed"];

type Row = Assessment & { application: Application | null };

/** Lists the latest assessment per app with URL-held filters and expansion, and app deletion for testers. */
export default function Assessments() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [appToDelete, setAppToDelete] = useState<Application | null>(null);
  const [appToReassess, setAppToReassess] = useState<Application | null>(null);

  const { data: assessments, isLoading, isFetching, isError, refetch } = useAssessments({ pollWhileInProgress: true });
  const { data: conversationActivity } = useConversationActivity();
  const { data: applications } = useApplications();
  const sortedApplications = useMemo(
    () =>
      [...(applications ?? [])].sort((a, b) =>
        compareByName(a.name, b.name, `${a.platform}:${a.id}`, `${b.platform}:${b.id}`),
      ),
    [applications],
  );

  const expandedId = params.get("expanded");
  /** Toggles the URL-held expanded assessment row. */
  const toggleExpand = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params);
      debug("toggles expanded assessment", { assessmentId: id, expanded: next.get("expanded") !== id });
      if (next.get("expanded") === id) next.delete("expanded");
      else next.set("expanded", id);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const {
    data: syncingRuns,
    isError: reportsError,
    error: reportsErrorDetail,
  } = useAutomationReports({ syncStatus: ["queued", "running"] }, { pollWhileAny: true });
  const { data: unsyncedRuns } = useAutomationReports({ syncStatus: ["failed"] });
  const deleteApp = useDeleteApplication();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const canRunTest = can("run_test");

  const platformFilter = params.get("platform") ?? "";
  const statusFilter = params.get("status") ?? "";
  const appFilter = params.get("application") ?? "";
  const activeFilters = [platformFilter, statusFilter, appFilter].filter(Boolean).length;
  const [filtersOpen, setFiltersOpen] = useState(activeFilters > 0);

  /** Sets or clears one URL filter parameter. */
  const setParam = useCallback((key: string, value: string) => {
    debug("changes filter", { key, value });
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

  useEffect(() => {
    if (!expandedId || isLoading) return;
    if (!rows.some((r) => r.id === expandedId)) {
      debug("clears stale expanded assessment", { assessmentId: expandedId });
      toggleExpand(expandedId);
    }
  }, [expandedId, isLoading, rows, toggleExpand]);

  const expandedRow = rows.find((r) => r.id === expandedId);
  const expandedStatus = useRef<{ id: string; status: string } | null>(null);
  useEffect(() => {
    const previous = expandedStatus.current;
    expandedStatus.current = expandedRow ? { id: expandedRow.id, status: expandedRow.status } : null;
    if (expandedRow?.status !== "completed" || previous?.id !== expandedRow.id) return;
    if (previous.status === "completed") return;
    debug("opens assessment that finished while expanded", { assessmentId: expandedRow.id, from: previous.status });
    navigate(`/assessments/${expandedRow.id}`);
  }, [expandedRow, navigate]);

  /** Deletes the selected application, closing the dialog or showing the error. */
  const confirmDelete = useCallback(async () => {
    if (!appToDelete) return;
    debug("confirms application delete", { applicationId: appToDelete.id });
    setDeleteError(null);
    try {
      await deleteApp.mutateAsync({ applicationId: appToDelete.id, applicationName: appToDelete.name });
      debug("deletes application", { applicationId: appToDelete.id });
      setAppToDelete(null);
    } catch (err) {
      debug("fails to delete application", { applicationId: appToDelete.id, error: err });
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
            <span className="flex flex-col">
              <span className="font-medium text-foreground">{r.application?.name ?? "—"}</span>
              {r.application && <PlatformBadge platform={r.application.platform} />}
            </span>
          </div>
        ),
      },
      { key: "version", header: "Version", render: (r) => assessmentVersion(r, r.application) ?? "—" },
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
              aria-label={`${r.application ? applicationLabel(r.application) : "Application"} security tests completed`}
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
      {
        key: "updated",
        header: "Last Updated",
        render: (r) => formatDate(conversationActivity?.get(r.application_id)),
      },
      ...(canRunTest
        ? [
            {
              key: "actions",
              header: "",
              render: (r: Row) =>
                r.application && (
                  <span className="flex items-center gap-3">
                    {canStartNewAssessment(
                      (assessments ?? []).filter((a) => a.application_id === r.application_id),
                    ) && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          debug("opens new version dialog", { applicationId: r.application?.id });
                          setAppToReassess(r.application);
                        }}
                        className="text-muted-foreground hover:text-primary"
                        title={`Assess a new version of ${applicationLabel(r.application)}`}
                        aria-label={`Assess a new version of ${applicationLabel(r.application)}`}
                      >
                        <PackagePlus className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        debug("opens delete dialog", { applicationId: r.application?.id });
                        setAppToDelete(r.application);
                      }}
                      className="text-muted-foreground hover:text-danger"
                      title={`Delete ${applicationLabel(r.application)}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </span>
                ),
            },
          ]
        : []),
    ],
    [assessments, canRunTest, conversationActivity],
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
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  debug("refreshes assessments");
                  void refetch();
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
            </>
          )
        }
      />

      {reportsError && (
        <p className="mb-3 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
          <span>
            {`Can't reach the automation backend (${
              reportsErrorDetail instanceof Error ? reportsErrorDetail.message : "network error"
            }). Check VITE_API_BASE_URL and its CORS origins — see docs/AUTOMATION_API.md.`}
          </span>
        </p>
      )}
      {!reportsError && (syncingRuns?.length ?? 0) > 0 && (
        <p className="mb-3 flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground">
          <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span>
            {`${syncingRuns!.length} completed run${syncingRuns!.length > 1 ? "s are" : " is"} being added to the dashboard.`}
          </span>
        </p>
      )}
      {!reportsError && (unsyncedRuns?.length ?? 0) > 0 && (
        <p className="mb-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span>
            {`${unsyncedRuns!.length} completed run${
              unsyncedRuns!.length > 1 ? "s" : ""
            } could not be added to the dashboard. Open `}
            {unsyncedRuns!.slice(0, UNSYNCED_RUN_LINKS).map((runTimestamp, index) => (
              <span key={runTimestamp}>
                {index > 0 && ", "}
                <Link
                  to={`/runs/${encodeURIComponent(runTimestamp)}`}
                  className="font-medium text-primary hover:underline"
                >
                  {runTimestamp}
                </Link>
              </span>
            ))}
            {unsyncedRuns!.length > UNSYNCED_RUN_LINKS
              ? ` and ${unsyncedRuns!.length - UNSYNCED_RUN_LINKS} more`
              : ""}
            {" to resync."}
          </span>
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            debug("toggles filters", { open: !filtersOpen, activeFilters });
            setFiltersOpen((open) => !open);
          }}
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
                {applicationLabel(app)}
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
      {isError && (
        <ErrorState
          message="Unable to load assessments."
          onRetry={() => {
            debug("retries assessments load");
            void refetch();
          }}
        />
      )}
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
          onRowClick={(r) => {
            debug("opens assessment", { assessmentId: r.id, status: r.status });
            navigate(`/assessments/${r.id}`);
          }}
          rowLabel={(r) => `Open the assessment for ${r.application ? applicationLabel(r.application) : "this application"}`}
          rowActivation={(r) => (r.status === "completed" ? "navigate" : "expand")}
          expandLabel={(r) =>
            `View setup and testing status for ${r.application ? applicationLabel(r.application) : "this application"}`
          }
          renderCard={(r) => (
            <span className="flex items-center gap-3">
              <ApplicationIcon application={r.application} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {r.application?.name ?? "—"}
                </span>
                {r.application && (
                  <span className="mt-0.5 block">
                    <PlatformBadge platform={r.application.platform} />
                  </span>
                )}
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {assessmentVersion(r, r.application) ? `Version ${assessmentVersion(r, r.application)}` : "Version unknown"} ·{" "}
                  {r.completed_tests} of {r.total_tests} tests
                </span>
                <span className="mt-1 block">
                  <AssessmentStatusBadge status={r.status} />
                </span>
              </span>
            </span>
          )}
          expandedRowId={expandedId}
          onToggleExpand={(r) => {
            debug("expands assessment row", { assessmentId: r.id, status: r.status });
            toggleExpand(r.id);
          }}
          renderExpanded={(r) =>
            INCOMPLETE_STATUSES.includes(r.status) ? (
              <AssessmentStatusPanel assessment={r} canRetry={canRunTest} />
            ) : null
          }
        />
      )}

      {appToReassess && (
        <NewVersionDialog
          application={appToReassess}
          open={!!appToReassess}
          onOpenChange={(open) => {
            if (!open) setAppToReassess(null);
          }}
        />
      )}

      <Dialog
        open={!!appToDelete}
        onOpenChange={(open) => {
          if (open) return;
          debug("dismisses delete dialog", { applicationId: appToDelete?.id });
          setAppToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {appToDelete && applicationLabel(appToDelete)}?</DialogTitle>
            <DialogDescription>
              This permanently deletes the application along with every assessment, finding, and
              ticket (and their messages/history) tied to it. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteError && <p className="text-xs text-danger">{deleteError}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                debug("cancels application delete", { applicationId: appToDelete?.id });
                setAppToDelete(null);
              }}
            >
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
