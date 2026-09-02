import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { PageHeader, LoadingState, ErrorState, EmptyState } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { StatusBadge, SeverityBadge, PlatformBadge, TicketBadge } from "@/components/data-display";
import { EvidenceViewer } from "@/components/evidence";
import { Timeline } from "@/components/timeline";
import { WorkOnRiskButton, AcceptRiskButton } from "@/components/ticket-actions";
import { RiskGoal } from "@/components/risk-goal";
import {
  useFinding,
  useFindingEvidenceItems,
  useFindingHistory,
  useFindingTickets,
  useActivity,
  useRiskCatalogue,
  useRiskControls,
  useTestRunHistory,
  useUpdateFindingStatus,
} from "@/hooks/queries";
import { ControlDefinitionList } from "@/components/control-definition-list";
import { formatDate } from "@/lib/utils";
import type { FindingStatus } from "@/data/types";

export default function FindingDetail() {
  const { findingId } = useParams<{ findingId: string }>();
  const { can, profile } = useAuth();
  const { data: finding, isLoading, isError, refetch } = useFinding(findingId);
  const application = finding?.application;

  const { data: evidence } = useFindingEvidenceItems(findingId);
  const { data: history } = useFindingHistory(findingId);
  const { data: tickets } = useFindingTickets(findingId);
  const { data: activity } = useActivity("finding", findingId);
  const { data: risks } = useRiskCatalogue(finding?.platform);
  const controls = useRiskControls(finding?.platform, finding?.test_id);
  const { data: runHistory } = useTestRunHistory(
    application?.external_id ?? undefined,
    finding?.test_id ?? undefined,
  );

  const riskDefinition = useMemo(
    () => risks?.find((r) => r.risk_id === finding?.test_id),
    [risks, finding?.test_id],
  );

  if (isLoading) return <LoadingState label="Loading finding…" />;
  if (isError || !finding) return <ErrorState message="Unable to load this finding." onRetry={() => refetch()} />;

  const showDeveloperActions = can("create_ticket") && finding.status !== "reduced_risk";

  return (
    <div>
      <PageHeader
        title={finding.title}
        description={`${application?.name ?? "Unknown application"} · Finding ${finding.id.slice(0, 8)}`}
        actions={showDeveloperActions ? <AcceptRiskButton finding={finding} /> : undefined}
      />

      <Card className="mb-6">
        <CardContent className="grid grid-cols-2 gap-4 py-4 sm:grid-cols-4">
          <Field label="Application" value={application?.name ?? "—"} />
          <Field label="Version" value={application?.version ?? "—"} />
          <Field label="Platform" value={<PlatformBadge platform={finding.platform} />} />
          <Field label="Severity" value={<SeverityBadge severity={finding.severity} />} />
          <Field label="Status" value={<StatusBadge status={finding.status} />} />
          <Field label="Date Found" value={formatDate(finding.created_at)} />
          <Field label="Finding ID" value={finding.id.slice(0, 8)} />
          {can("update_finding") && (
            <div className="col-span-2 sm:col-span-4">
              <SecurityStatusOverride findingId={finding.id} currentStatus={finding.status} />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Section title="Description">
          <p className="text-sm text-foreground">{finding.description || "No description provided."}</p>
        </Section>

        <Section title="Impact">
          <p className="text-sm text-foreground">{finding.impact || "No impact statement provided."}</p>
        </Section>

        <Section title="Evidence">
          <EvidenceViewer items={evidence ?? []} />
        </Section>

        <Section title="Remediation Guidance">
          {riskDefinition ? (
            <RiskGoal risk={riskDefinition} />
          ) : (
            <p className="text-sm text-muted-foreground">No remediation guidance available for this test.</p>
          )}
        </Section>

        <Section title="Developer remediation controls">
          <p className="mb-3 text-xs text-muted-foreground">
            Each control is a way to address this risk, with the steps a developer follows to
            implement it. These are not the steps security uses to demonstrate the risk. Reading
            them records nothing.
          </p>
          {!finding.test_id ? (
            <p className="text-sm text-muted-foreground">
              This finding is not linked to a playbook risk, so it has no developer controls.
            </p>
          ) : controls.isLoading ? (
            <LoadingState label="Loading remediation controls…" />
          ) : controls.isError ? (
            <ErrorState
              message="The automation backend could not provide the remediation controls for this risk."
              onRetry={() => controls.refetch()}
            />
          ) : (
            <ControlDefinitionList
              controls={controls.data}
              linkTo={(controlId) => `/findings/${finding.id}/controls/${controlId}`}
            />
          )}
          {showDeveloperActions && (
            <div className="mt-4 border-t border-border pt-4">
              <WorkOnRiskButton finding={finding} application={application} />
            </div>
          )}
        </Section>

        <Section title="Test History">
          {(runHistory ?? []).length === 0 ? (
            <EmptyState title="No automated runs recorded for this test yet." />
          ) : (
            <ul className="divide-y divide-border">
              {(runHistory ?? []).map((run) => (
                <li key={run.run_timestamp} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-muted-foreground">{formatDate(run.started_at)}</span>
                  <span className="text-foreground">{run.status}</span>
                  <span>{run.verdict}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Related Tickets">
          {(tickets ?? []).length === 0 ? (
            <EmptyState title="No tickets yet." />
          ) : (
            <ul className="divide-y divide-border">
              {(tickets ?? []).map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                  <Link to={`/tickets/${t.id}`} className="font-medium text-foreground hover:text-primary">
                    {t.title}
                  </Link>
                  <TicketBadge status={t.status} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Activity">
          <Timeline entries={activity ?? []} />
        </Section>
      </div>

      {profile?.roles.includes("cio") && (history ?? []).length > 0 && (
        <Card className="mt-6">
          <CardContent className="py-4">
            <h2 className="mb-2 text-sm font-semibold text-foreground">Status History</h2>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {(history ?? []).map((h) => (
                <li key={h.id}>
                  {formatDate(h.created_at)}: {h.previous_status ?? "—"} → {h.new_status}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SecurityStatusOverride({
  findingId,
  currentStatus,
}: {
  findingId: string;
  currentStatus: FindingStatus;
}) {
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<FindingStatus>(currentStatus);
  const update = useUpdateFindingStatus(findingId);

  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Security Team: manual status override
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <select
          className="h-9 rounded-md border border-border bg-card px-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value as FindingStatus)}
        >
          <option value="at_risk">At Risk</option>
          <option value="reduced_risk">Reduced Risk</option>
          <option value="inconclusive">Inconclusive</option>
        </select>
        <Textarea
          className="max-w-xs"
          rows={1}
          placeholder="Reason (recorded in finding history)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button
          size="sm"
          disabled={update.isPending || status === currentStatus || !reason}
          onClick={() => update.mutate({ status, reason })}
        >
          Update Status
        </Button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-foreground">{title}</h2>
      <Card>
        <CardContent className="py-4">{children}</CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}
