import { Navigate, useParams } from "react-router-dom";
import { PageHeader, LoadingState, ErrorState, EmptyState } from "@/components/common";
import { ApplicationIcon } from "@/components/application-icon";
import { PlatformBadge } from "@/components/data-display";
import { useApplications, useFindings, useTickets } from "@/hooks/queries";
import { preferredDeveloperRisk } from "@/lib/resolve";

/**
 * There is no application overview in the developer flow: opening an application
 * opens the feature-risk that most needs attention. The route stays so older
 * links, and the Resolve list, keep working.
 */
export default function ResolveApplication() {
  const { applicationId } = useParams<{ applicationId: string }>();
  const applications = useApplications();
  const findings = useFindings({ applicationId });
  const tickets = useTickets({ type: "remediation", applicationId });

  const application = applications.data?.find((candidate) => candidate.id === applicationId);

  // This route only redirects, so it waits for the data that decides where to
  // go — but not for a refetch of data it already has.
  if ((!application && applications.isLoading) || findings.isLoading || tickets.isLoading) {
    return <LoadingState label="Opening your remediation work…" />;
  }
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
