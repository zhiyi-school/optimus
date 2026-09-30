/**
 * Resolve application route that redirects developers to the risk needing most attention.
 */

import { Navigate, useParams } from "react-router-dom";
import { PageHeader, LoadingState, ErrorState, EmptyState } from "@/components/layout/page-blocks";
import { ApplicationIcon } from "@/components/shared/application-icon";
import { PlatformBadge } from "@/components/shared/badges-and-table";
import { useApplications } from "@/hooks/queries/reference";
import { useFindings } from "@/hooks/queries/evidence";
import { useTickets } from "@/hooks/queries/tickets";
import { createDebug } from "@/lib/debug";
import { preferredDeveloperRisk } from "@/domain/remediation/resolve-rules";

const debug = createDebug("page:ResolveApplication");

/** Redirects to the application's most urgent developer risk, or shows an empty state when none exists. */
export default function ResolveApplication() {
  const { applicationId } = useParams<{ applicationId: string }>();
  const applications = useApplications();
  const findings = useFindings({ applicationId });
  const tickets = useTickets({ type: "remediation", applicationId });

  const application = applications.data?.find((candidate) => candidate.id === applicationId);

  if ((!application && applications.isLoading) || findings.isLoading || tickets.isLoading) {
    return <LoadingState label="Opening your remediation work…" />;
  }
  if (applications.isError || findings.isError || !application) {
    return (
      <ErrorState
        message="Unable to load this application."
        onRetry={() => {
          debug("retries application load", { applicationId });
          void applications.refetch();
          void findings.refetch();
        }}
      />
    );
  }

  const riskId = preferredDeveloperRisk(findings.data, tickets.data);
  if (riskId) {
    return (
      <Navigate
        to={`/resolve/applications/${applicationId}/risks/${encodeURIComponent(riskId)}`}
        replace
      />
    );
  }

  return (
    <div>
      <PageHeader
        title={application.name}
        description={application.version ? `Version ${application.version}` : "Version unknown"}
        actions={
          <div className="flex items-center gap-2">
            <ApplicationIcon application={application} className="h-8 w-8" iconClassName="h-4 w-4" />
            <PlatformBadge platform={application.platform} />
          </div>
        }
      />
      <EmptyState
        title="Nothing to remediate on this application"
        description="Security has not raised a finding linked to a security test here yet. It appears in Resolve as soon as one is recorded."
      />
    </div>
  );
}
