/**
 * Assessment workspace sidebar listing tested risks with their finding status, the tested version and the app's assessments.
 */

import { useMemo } from "react";
import { RiskSidebar, type RiskSidebarEntry } from "@/components/layout/risk-sidebar";
import { AssessmentHistory } from "@/components/assessment/assessment-history";
import { assessmentVersion } from "@/domain/assessment/build-versions";
import type { RiskDefinition } from "@/automation-api/types";
import type { Application, Assessment, Finding } from "@/database/types";

interface AssessmentSidebarProps {
  application: Application | null | undefined;
  assessment: Assessment;
  risks: RiskDefinition[] | undefined;
  findingByTestId: Map<string, Finding & { application: Application | null }>;
  activeTestId?: string;
  /** Every assessment of the application; when given, they are listed below the risks. */
  appAssessments?: Assessment[];
  canAssessNewVersion?: boolean;
}

/** Maps the risk catalogue to sidebar entries linked to this assessment's test pages. */
export function AssessmentSidebar({
  application,
  assessment,
  risks,
  findingByTestId,
  activeTestId,
  appAssessments,
  canAssessNewVersion = false,
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
      version={assessmentVersion(assessment, application)}
      footer={
        appAssessments && (
          <AssessmentHistory
            application={application}
            currentAssessmentId={assessment.id}
            assessments={appAssessments}
            mayStart={canAssessNewVersion}
          />
        )
      }
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
