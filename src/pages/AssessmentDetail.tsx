import { useMemo } from "react";
import { Navigate, useParams } from "react-router-dom";
import { preferredAssessmentRisk } from "@/lib/assessments";
import { LoadingState, ErrorState, EmptyState } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { AssessmentSidebar } from "@/components/assessment-sidebar";
import { useAssessment, useFindings, useRiskCatalogue } from "@/hooks/queries";
import { formatDate } from "@/lib/utils";
import type { Application, Finding } from "@/data/types";

/**
 * A direct or bookmarked link to `/assessments/:assessmentId`. Queued,
 * waiting, running, and pre-completion failures are handled entirely on the
 * main Assessments page — this route only ever shows a completed result, or
 * redirects there.
 */
export default function AssessmentDetail() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const { data: assessment, isLoading, isError, refetch } = useAssessment(assessmentId);
  const application = assessment?.application;
  const platform = application?.platform;
  const riskCatalogue = useRiskCatalogue(platform);
  const risks = riskCatalogue.data;
  const { data: findings } = useFindings({ applicationId: assessment?.application_id });

  const findingByTestId = useMemo(() => {
    const map = new Map<string, Finding & { application: Application | null }>();
    for (const f of findings ?? []) {
      if (f.test_id) map.set(f.test_id, f);
    }
    return map;
  }, [findings]);

  if (isLoading) return <LoadingState label="Loading assessment…" />;
  if (isError || !assessment)
    return <ErrorState message="Unable to load this assessment." onRetry={() => refetch()} />;

  if (assessment.status !== "completed") {
    return <Navigate to={`/assessments?expanded=${assessment.id}`} replace />;
  }

  // A completed assessment has no setup left to narrate, so it opens straight
  // onto a feature-risk rather than an empty pane.
  if (!riskCatalogue.isLoading) {
    const preferred = preferredAssessmentRisk(risks, findings);
    if (preferred) {
      return (
        <Navigate
          to={`/assessments/${assessment.id}/tests/${encodeURIComponent(preferred)}`}
          replace
        />
      );
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <AssessmentSidebar
        application={assessment.application}
        assessment={assessment}
        risks={risks}
        findingByTestId={findingByTestId}
      />

      <div className="min-w-0 space-y-4">
        {riskCatalogue.isLoading ? (
          <LoadingState label="Opening the assessment…" />
        ) : (
          <Card>
            <CardContent className="py-4">
              <h2 className="text-sm font-semibold text-foreground">Assessment complete</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {assessment.completed_tests} of {assessment.total_tests} security tests were
                recorded for {application?.name ?? "this app"} on {formatDate(assessment.updated_at)}.
              </p>
              <div className="mt-4">
                <EmptyState
                  title="No security tests are available for this assessment"
                  description="The automation backend returned no test catalogue for this platform, so there is no feature-risk to open. Check that its playbook directory is configured and reachable."
                />
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
