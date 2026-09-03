import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { PageHeader, LoadingState, ErrorState, EmptyState } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { ApplicationIcon } from "@/components/application-icon";
import { PlatformBadge } from "@/components/data-display";
import { ProgressBar, ToneBadge } from "@/components/resolve-display";
import {
  useApplications,
  useControlProgressForTickets,
  useFindings,
  useLiveControlKeys,
  useTeams,
  useTickets,
} from "@/hooks/queries";
import { remediationStatusLabels, summarizeApplication } from "@/lib/resolve";
import { formatDate } from "@/lib/utils";

export default function Resolve() {
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

  const rows = useMemo(() => {
    return (applications.data ?? [])
      .map((application) => ({
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
      .sort((a, b) => b.summary.findingsRequiringAction - a.summary.findingsRequiringAction);
  }, [applications.data, findings.data, tickets.data, controls.controls, controls.steps, liveKeys]);

  const isLoading = applications.isLoading || findings.isLoading || tickets.isLoading;
  const isError = applications.isError || findings.isError || tickets.isError;

  return (
    <div>
      <PageHeader
        title="Resolve"
        description={
          team
            ? `Remediation work for ${team.name}.`
            : "Remediation work for the applications your team owns."
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
        <div className="space-y-3">
          {rows.map(({ application, summary }) => {
            const status = remediationStatusLabels[summary.status];
            return (
              <Link key={application.id} to={`/resolve/applications/${application.id}`}>
                <Card className="transition-all hover:border-primary/40 hover:shadow-card-hover">
                  <CardContent className="py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <ApplicationIcon application={application} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {application.name}
                          </p>
                          <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                            <PlatformBadge platform={application.platform} />
                            {application.version ? `Version ${application.version}` : "Version unknown"}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <ToneBadge tone={status.tone} label={status.label} />
                        <span className="text-xs text-muted-foreground">
                          Updated {formatDate(summary.lastUpdatedAt)}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                      <Metric label="Affected findings" value={summary.affectedFindings} />
                      <Metric label="Findings needing action" value={summary.findingsRequiringAction} />
                      <Metric label="Fixes submitted" value={summary.fixesSubmitted} />
                      <Metric label="Awaiting security" value={summary.awaitingReassessment} />
                      <Metric label="Resolved findings" value={summary.resolvedFindings} />
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <ProgressBar label="Findings resolved" progress={summary.findings} />
                      <ProgressBar label="Remediation steps completed" progress={summary.controls} />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}
