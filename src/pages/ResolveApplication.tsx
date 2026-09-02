import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHeader, LoadingState, ErrorState, EmptyState } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { ApplicationIcon } from "@/components/application-icon";
import { PlatformBadge, SeverityBadge, StatusBadge } from "@/components/data-display";
import { ProgressBar, ToneBadge } from "@/components/resolve-display";
import {
  useApplications,
  useControlProgressForTickets,
  useFindings,
  useLiveControlKeys,
  useTickets,
} from "@/hooks/queries";
import {
  activeRemediationTicket,
  developerTicketLabel,
  remediationStatusLabels,
  resumableRemediationTicket,
  summarizeApplication,
} from "@/lib/resolve";
import { severityLabelOf } from "@/lib/status";
import { formatDate } from "@/lib/utils";
import type { Finding } from "@/data/types";

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"];

export default function ResolveApplication() {
  const { applicationId } = useParams<{ applicationId: string }>();
  const applications = useApplications();
  const findings = useFindings({ applicationId });
  const tickets = useTickets({ type: "remediation", applicationId });

  const application = applications.data?.find((candidate) => candidate.id === applicationId);
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

  const summary = useMemo(
    () =>
      summarizeApplication(
        applicationId ?? "",
        findings.data ?? [],
        tickets.data ?? [],
        controls.controls,
        controls.steps,
        liveKeys,
      ),
    [applicationId, findings.data, tickets.data, controls.controls, controls.steps, liveKeys],
  );

  const bySeverity = useMemo(() => countBySeverity(findings.data ?? []), [findings.data]);

  if (applications.isLoading || findings.isLoading) return <LoadingState label="Loading…" />;
  if (applications.isError || findings.isError || !application) {
    return (
      <ErrorState
        message="Unable to load this application."
        onRetry={() => {
          void applications.refetch();
          void findings.refetch();
        }}
      />
    );
  }

  const status = remediationStatusLabels[summary.status];
  const actionable = (findings.data ?? []).filter(
    (finding) => finding.status === "at_risk" || finding.status === "reduced_risk",
  );

  return (
    <div>
      <PageHeader
        title={application.name}
        description={application.version ? `Version ${application.version}` : "Version unknown"}
        actions={
          <div className="flex items-center gap-2">
            <ApplicationIcon application={application} className="h-8 w-8" iconClassName="h-4 w-4" />
            <PlatformBadge platform={application.platform} />
            <ToneBadge tone={status.tone} label={status.label} />
          </div>
        }
      />

      <Card className="mb-6">
        <CardContent className="py-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Metric label="Findings needing action" value={summary.findingsRequiringAction} />
            <Metric label="Controls awaiting completion" value={summary.requiredControls - summary.controlsCompleted} />
            <Metric label="Awaiting security verification" value={summary.awaitingReassessment} />
            <Metric label="Resolved findings" value={summary.resolvedFindings} />
            <Metric label="Withdrawn" value={summary.withdrawnTickets} />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ProgressBar label="Findings resolved" progress={summary.findings} />
            <ProgressBar label="Control steps completed" progress={summary.controls} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Remediation progress tracks developer work on findings. It is separate from how far
            security has got through running its tests.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="Findings">
            {actionable.length === 0 ? (
              <EmptyState title="No findings need your attention on this application." />
            ) : (
              <ul className="divide-y divide-border">
                {actionable.map((finding) => {
                  const active = activeRemediationTicket(finding.id, tickets.data);
                  const withdrawn = resumableRemediationTicket(finding.id, tickets.data);
                  const ticket = active ?? withdrawn;
                  const label = developerTicketLabel(ticket?.status);
                  return (
                    <li key={finding.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                      <div className="min-w-0">
                        <Link
                          to={`/findings/${finding.id}`}
                          className="text-sm font-medium text-foreground hover:text-primary"
                        >
                          {finding.title}
                        </Link>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {severityLabelOf(finding.severity)} · {finding.test_id ?? "No linked risk"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge status={finding.status} />
                        {label && <ToneBadge tone={label.tone} label={label.label} />}
                        <Link
                          to={
                            active
                              ? `/resolve/tickets/${active.id}`
                              : withdrawn
                                ? `/resolve/tickets/${withdrawn.id}`
                                : `/findings/${finding.id}`
                          }
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          {active
                            ? "Continue remediation"
                            : withdrawn
                              ? "Resume remediation"
                              : "View controls"}
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title="Recent conversations">
            {(tickets.data ?? []).length === 0 ? (
              <EmptyState title="No remediation tickets yet." />
            ) : (
              <ul className="divide-y divide-border">
                {(tickets.data ?? []).slice(0, 8).map((ticket) => {
                  const label = developerTicketLabel(ticket.status);
                  return (
                    <li key={ticket.id} className="flex items-center justify-between gap-2 py-2">
                      <Link
                        to={`/resolve/tickets/${ticket.id}`}
                        className="truncate text-sm text-foreground hover:text-primary"
                      >
                        {ticket.title}
                      </Link>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        {formatDate(ticket.updated_at)}
                        {label && <ToneBadge tone={label.tone} label={label.label} />}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Findings by severity">
            {bySeverity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No findings recorded.</p>
            ) : (
              <ul className="space-y-2">
                {bySeverity.map(([severity, count]) => (
                  <li key={severity} className="flex items-center justify-between text-sm">
                    <SeverityBadge severity={severity} />
                    <span className="font-medium text-foreground">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Activity">
            <p className="text-sm text-muted-foreground">
              Activity and conversation are recorded per remediation ticket. Open a finding above to
              see its history.
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function countBySeverity(findings: Finding[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    if (finding.status !== "at_risk") continue;
    const key = (finding.severity ?? "info").toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a[0]) - SEVERITY_ORDER.indexOf(b[0]),
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-foreground">{title}</h2>
      <Card>
        <CardContent className="space-y-2 py-4">{children}</CardContent>
      </Card>
    </div>
  );
}
