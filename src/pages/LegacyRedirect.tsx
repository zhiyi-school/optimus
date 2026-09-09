import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { LoadingState } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { useFinding } from "@/hooks/queries/evidence";
import { useFindingTickets, useTicket } from "@/hooks/queries/tickets";
import { canonicalRiskPath, resolveRiskPath, type RiskLocation } from "@/lib/legacy-routes";

/** Where a role's own list lives now that Findings and Tickets left the navigation. */
function listHomeFor(can: (capability: "view_assessments" | "view_resolve") => boolean): string {
  if (can("view_assessments")) return "/assessments";
  if (can("view_resolve")) return "/resolve";
  return "/";
}

export function LegacyListRedirect() {
  const { can, loading } = useAuth();
  if (loading) return <LoadingState label="Loading…" />;
  return <Navigate to={listHomeFor(can)} replace />;
}

export function LegacyFindingRedirect() {
  const { findingId, controlId } = useParams<{ findingId: string; controlId?: string }>();
  const { can, loading } = useAuth();
  const finding = useFinding(findingId);
  const tickets = useFindingTickets(findingId);

  if (loading || finding.isLoading || tickets.isLoading) {
    return <LoadingState label="Opening this finding…" />;
  }
  if (finding.isError || !finding.data) {
    return <UnlinkedNotice what="finding" id={findingId} />;
  }

  const location: RiskLocation = {
    applicationId: finding.data.application_id,
    assessmentId: finding.data.assessment_id,
    riskId: finding.data.test_id,
  };
  const target = canonicalRiskPath(location, {
    security: can("view_assessments"),
    developer: can("view_resolve"),
    controlId,
  });
  if (!target) return <UnlinkedNotice what="finding" id={findingId} />;
  return <Navigate to={target} replace />;
}

export function LegacyTicketRedirect() {
  const { ticketId, controlId } = useParams<{ ticketId: string; controlId?: string }>();
  const [params] = useSearchParams();
  const { can, loading } = useAuth();
  const ticket = useTicket(ticketId);

  if (loading || ticket.isLoading) return <LoadingState label="Opening this ticket…" />;
  if (ticket.isError || !ticket.data) return <UnlinkedNotice what="ticket" id={ticketId} />;

  // Provisioning work belongs to an assessment's setup, not to a feature-risk.
  if (ticket.data.type === "app_provisioning") {
    const assessment = ticket.data.origin_assessment_id;
    return (
      <Navigate
        to={assessment ? `/assessments/${assessment}` : "/assessments"}
        replace
      />
    );
  }

  const location: RiskLocation = {
    applicationId: ticket.data.application_id,
    assessmentId: ticket.data.origin_assessment_id,
    riskId: ticket.data.finding?.test_id ?? null,
  };
  const target = canonicalRiskPath(location, {
    security: can("view_assessments"),
    developer: can("view_resolve"),
    controlId: controlId ?? params.get("control") ?? undefined,
  });
  if (!target) return <UnlinkedNotice what="ticket" id={ticketId} />;
  return <Navigate to={target} replace />;
}

/**
 * A remediation has no page of its own: it is a section of the risk workspace.
 * This stays inside Resolve so a mixed-role user following a `/resolve/...` link
 * is not moved into the assessment workspace.
 */
export function ResolveTicketRedirect() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const ticket = useTicket(ticketId);

  if (ticket.isLoading) return <LoadingState label="Opening this remediation…" />;
  if (ticket.isError || !ticket.data) return <Navigate to="/resolve" replace />;

  return (
    <Navigate
      to={resolveRiskPath({
        applicationId: ticket.data.application_id,
        riskId: ticket.data.finding?.test_id,
      })}
      replace
    />
  );
}

/**
 * Legacy rows can predate risk conversations and carry no risk, assessment or
 * application. They stay reachable and are named as needing repair rather than
 * being redirected into an unrelated risk.
 */
function UnlinkedNotice({ what, id }: { what: "finding" | "ticket"; id: string | undefined }) {
  return (
    <Card className="mx-auto max-w-lg">
      <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
        <p className="text-sm font-semibold text-foreground">
          This {what} is not linked to a feature-risk
        </p>
        <p className="max-w-sm text-xs text-muted-foreground">
          It predates risk workspaces, or the records it pointed at are gone, so there is no
          workspace to open. Ask an administrator to repair it.
        </p>
        {id && <p className="text-xs text-muted-foreground">Reference: {id}</p>}
      </CardContent>
    </Card>
  );
}
