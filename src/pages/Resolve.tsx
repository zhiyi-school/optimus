import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { PageHeader, LoadingState, ErrorState, EmptyState } from "@/components/common";
import { DataTable, type DataTableColumn } from "@/components/data-display";
import { ApplicationIcon } from "@/components/application-icon";
import { ProgressBar, ToneBadge } from "@/components/resolve-display";
import {
  useApplications,
  useControlProgressForTickets,
  useFindings,
  useLiveControlKeys,
  useTeams,
  useTickets,
} from "@/hooks/queries";
import { useAuth } from "@/auth/useAuth";
import {
  remediationStatusLabels,
  summarizeApplication,
  type ApplicationRemediation,
} from "@/lib/resolve";
import { compareByName, formatDate } from "@/lib/utils";
import type { Application } from "@/data/types";

interface Row {
  id: string;
  application: Application;
  summary: ApplicationRemediation;
}

export default function Resolve() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { data: teams } = useTeams();
  const team = teams?.find((candidate) => candidate.id === profile?.team_id);

  const applications = useApplications();
  const findings = useFindings();
  const tickets = useTickets({ type: "remediation" });

  const ticketIds = useMemo(() => (tickets.data ?? []).map((ticket) => ticket.id), [tickets.data]);
  const controls = useControlProgressForTickets(ticketIds);
  const risks = useMemo(
    () =>
      (findings.data ?? [])
        .filter((finding) => finding.test_id)
        .map((finding) => ({ platform: finding.platform, riskId: finding.test_id as string })),
    [findings.data],
  );
  const liveKeys = useLiveControlKeys(risks);

  const rows = useMemo<Row[]>(() => {
    return (applications.data ?? [])
      .map((application) => ({
        id: application.id,
        application,
        summary: summarizeApplication(
          application.id,
          findings.data ?? [],
          tickets.data ?? [],
          controls.controls,
          controls.steps,
          liveKeys,
        ),
      }))
      .sort((a, b) => compareByName(a.application.name, b.application.name, a.application.id, b.application.id));
  }, [applications.data, findings.data, tickets.data, controls.controls, controls.steps, liveKeys]);

  const columns: DataTableColumn<Row>[] = useMemo(
    () => [
      {
        key: "app",
        header: "App",
        render: (row) => (
          <div className="flex items-center gap-3">
            <ApplicationIcon application={row.application} />
            <span className="font-medium text-foreground">{row.application.name}</span>
          </div>
        ),
      },
      { key: "version", header: "Version", render: (row) => row.application.version ?? "—" },
      {
        key: "progress",
        header: "Progress",
        render: (row) => (
          <div className="w-40">
            <ProgressBar label="Remediation steps" progress={row.summary.controls} />
          </div>
        ),
      },
      {
        key: "status",
        header: "Status",
        render: (row) => {
          const status = remediationStatusLabels[row.summary.status];
          return <ToneBadge tone={status.tone} label={status.label} />;
        },
      },
      {
        key: "updated",
        header: "Created At",
        render: (row) => formatDate(row.summary.lastUpdatedAt),
      },
    ],
    [],
  );

  // Only a first load with nothing cached replaces the table; a background
  // refetch of any of these leaves the rows on screen.
  const isLoading = rows.length === 0 && (applications.isLoading || findings.isLoading || tickets.isLoading);
  const isFetching = applications.isFetching || findings.isFetching || tickets.isFetching;
  const isError = applications.isError || findings.isError || tickets.isError;

  return (
    <div>
      <PageHeader
        title="Resolve"
        description="View and resolve findings from your application assessments."
        actions={
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {team?.name}
            {isFetching && !isLoading && (
              <RefreshCw
                aria-label="Refreshing"
                className="h-3 w-3 animate-spin text-muted-foreground/70 motion-reduce:animate-none"
              />
            )}
          </span>
        }
      />

      {isLoading && <LoadingState label="Loading your applications…" />}
      {isError && (
        <ErrorState
          message="Unable to load your remediation work."
          onRetry={() => {
            void applications.refetch();
            void findings.refetch();
            void tickets.refetch();
          }}
        />
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <EmptyState
          title="No applications are assigned to your team yet"
          description="Applications appear here once security assigns one to your developer team."
        />
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <DataTable
          columns={columns}
          rows={rows}
          onRowClick={(row) => navigate(`/resolve/applications/${row.application.id}`)}
          rowLabel={(row) => `Open remediation work for ${row.application.name}`}
          renderCard={(row) => {
            const status = remediationStatusLabels[row.summary.status];
            return (
              <span className="flex items-center gap-3">
                <ApplicationIcon application={row.application} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {row.application.name}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {row.application.version
                      ? `Version ${row.application.version}`
                      : "Version unknown"}{" "}
                    · {row.summary.controls.completed} of {row.summary.controls.total} steps
                  </span>
                  <span className="mt-1 block">
                    <ToneBadge tone={status.tone} label={status.label} />
                  </span>
                </span>
              </span>
            );
          }}
        />
      )}
    </div>
  );
}
