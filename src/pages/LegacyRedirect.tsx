/**
 * Redirects retired Findings, Tickets and remediation links to the current risk workspaces.
 */

import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { LoadingState } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { useFinding } from "@/hooks/queries/evidence";
import { useFindingTickets, useTicket } from "@/hooks/queries/tickets";
import { canonicalRiskPath, resolveRiskPath, type RiskLocation } from "@/lib/legacy-routes";

/** Returns the list page a role lands on now that Findings and Tickets left the navigation. */
function listHomeFor(can: (capability: "view_assessments" | "view_resolve") => boolean): string {
  if (can("view_assessments")) return "/assessments";
  if (can("view_resolve")) return "/resolve";
  return "/";
}

/** Redirects the retired list routes to the user's role-appropriate list page. */
export function LegacyListRedirect() {
  const { can, loading } = useAuth();
  if (loading) return <LoadingState label="Loading…" />;
  return <Navigate to={listHomeFor(can)} replace />;
}

/** Redirects a legacy finding link to its risk workspace, or explains that it is unlinked. */
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

/** Redirects a legacy ticket link to its risk workspace, or to the assessment for provisioning tickets. */
export function LegacyTicketRedirect() {
  const { ticketId, controlId } = useParams<{ ticketId: string; controlId?: string }>();
  const [params] = useSearchParams();
  const { can, loading } = useAuth();
  const ticket = useTicket(ticketId);

  if (loading || ticket.isLoading) return <LoadingState label="Opening this ticket…" />;
  if (ticket.isError || !ticket.data) return <UnlinkedNotice what="ticket" id={ticketId} />;

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

/** Redirects a Resolve ticket link to its risk workspace, staying inside Resolve for mixed-role users. */
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

/** Explains that a legacy finding or ticket has no linked risk and needs administrator repair. */
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
