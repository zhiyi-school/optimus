import { useMemo } from "react";
import { RiskSidebar, type RiskSidebarEntry } from "@/components/risk-sidebar";
import type { RiskDefinition } from "@/api/automation-types";
import type { Application, Assessment, Finding } from "@/data/types";

interface AssessmentSidebarProps {
  application: Application | null | undefined;
  assessment: Assessment;
  risks: RiskDefinition[] | undefined;
  findingByTestId: Map<string, Finding & { application: Application | null }>;
  /** Highlights the currently-open test's row — passed by TestDetail, omitted on AssessmentDetail. */
  activeTestId?: string;
}

export function AssessmentSidebar({
  application,
  assessment,
  risks,
  findingByTestId,
  activeTestId,
}: AssessmentSidebarProps) {
  const entries = useMemo<RiskSidebarEntry[]>(
    () =>
      (risks ?? []).map((risk) => ({
        riskId: risk.risk_id,
        name: risk.name,
        status: findingByTestId.get(risk.risk_id)?.status,
      })),
    [risks, findingByTestId],
  );

  return (
    <RiskSidebar
      backTo="/assessments"
      backLabel="Back to Assessments"
      application={application}
      progress={{
        completed: assessment.completed_tests,
        total: assessment.total_tests,
        label: "tests completed",
      }}
      risks={entries}
      activeRiskId={activeTestId}
      riskHref={(riskId) => `/assessments/${assessment.id}/tests/${riskId}`}
      emptyMessage="No test catalogue returned by the automation backend for this platform."
    />
  );
}
