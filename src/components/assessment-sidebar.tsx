/**
 * Assessment workspace sidebar listing tested risks with their finding status.
 */

import { useMemo } from "react";
import { RiskSidebar, type RiskSidebarEntry } from "@/components/risk-sidebar";
import type { RiskDefinition } from "@/automation-api/types";
import type { Application, Assessment, Finding } from "@/database/types";

interface AssessmentSidebarProps {
  application: Application | null | undefined;
  assessment: Assessment;
  risks: RiskDefinition[] | undefined;
  findingByTestId: Map<string, Finding & { application: Application | null }>;
  activeTestId?: string;
}

/** Maps the risk catalogue to sidebar entries linked to this assessment's test pages. */
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
        label: "risks tested",
      }}
      risks={entries}
      activeRiskId={activeTestId}
      riskHref={(riskId) => `/assessments/${assessment.id}/tests/${riskId}`}
      emptyMessage="No test catalogue returned by the automation backend for this platform."
    />
  );
}
