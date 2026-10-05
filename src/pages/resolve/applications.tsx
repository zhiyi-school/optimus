/**
 * Developer Resolve list summarizing remediation progress per application.
 */

import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { PageHeader, LoadingState, ErrorState, EmptyState } from "@/components/layout/page-blocks";
import { DataTable, type DataTableColumn } from "@/components/shared/badges-and-table";
import { ApplicationIcon } from "@/components/shared/application-icon";
import { ProgressBar, ToneBadge } from "@/components/shared/progress-display";
import { useApplications, useTeams } from "@/hooks/queries/reference";
import { useFindings } from "@/hooks/queries/evidence";
import { useControlProgressForTickets } from "@/hooks/queries/control-progress";
import { useTickets } from "@/hooks/queries/tickets";
import { useConversationActivity } from "@/hooks/queries/conversations";
import { useRiskCatalogue } from "@/hooks/queries/automation";
import { useLiveControlKeys } from "@/hooks/queries/playbook";
import { useAuth } from "@/auth/auth-context";
import { createDebug } from "@/lib/debug";
import {
  acceptedFindingIds,
  remediationStatusLabels,
  summarizeApplication,
  type ApplicationRemediation,
} from "@/domain/remediation/resolve-rules";
import { compareByName, formatDate } from "@/lib/utils";
import type { Application } from "@/database/types";

const debug = createDebug("pages:resolve:applications");

interface Row {
  id: string;
  application: Application;
  summary: ApplicationRemediation;
  /** When the application's risk conversations last recorded an entry. */
  lastUpdatedAt: string | undefined;
}

/** Lists the team's applications with remediation progress and status, opening one on click. */
export default function Resolve() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { data: teams } = useTeams();
  const team = teams?.find((candidate) => candidate.id === profile?.team_id);

  const applications = useApplications();
  const findings = useFindings();
  const tickets = useTickets({ type: "remediation" });
  const acceptanceTickets = useTickets({ type: "risk_acceptance", status: "accepted" });
  const accepted = useMemo(() => acceptedFindingIds(acceptanceTickets.data), [acceptanceTickets.data]);
  const activity = useConversationActivity();

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
  const iosCatalogue = useRiskCatalogue("ios");
  const androidCatalogue = useRiskCatalogue("android");
  /** Returns the number of risks in the given platform's catalogue. */
  const catalogueSize = useCallback(
    (platform: string) =>
      (platform === "ios" ? iosCatalogue.data : androidCatalogue.data)?.length ?? 0,
    [iosCatalogue.data, androidCatalogue.data],
  );

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
          catalogueSize(application.platform),
          accepted,
        ),
        lastUpdatedAt: activity.data?.get(application.id),
      }))
      .sort((a, b) => compareByName(a.application.name, b.application.name, a.application.id, b.application.id));
  }, [applications.data, findings.data, tickets.data, controls.controls, controls.steps, liveKeys, catalogueSize, accepted, activity.data]);

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
            <ProgressBar label="Risks tested" progress={row.summary.tested} />
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
        header: "Last Updated",
        render: (row) => formatDate(row.lastUpdatedAt),
      },
    ],
    [],
  );

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
            debug("retries remediation load", {
              applicationsError: applications.isError,
              findingsError: findings.isError,
              ticketsError: tickets.isError,
            });
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
          onRowClick={(row) => {
            debug("opens application", { applicationId: row.application.id, status: row.summary.status });
            navigate(`/resolve/applications/${row.application.id}`);
          }}
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
