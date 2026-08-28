import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, PlatformBadge } from "@/components/data-display";
import { appTypeIcon, riskIcon } from "@/lib/entity-icons";
import { cn } from "@/lib/utils";
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
  const navigate = useNavigate();
  const AppIcon = appTypeIcon(application?.app_type);
  const pct =
    assessment.total_tests > 0
      ? Math.min(100, Math.round((assessment.completed_tests / assessment.total_tests) * 100))
      : 0;

  return (
    <div>
      <Link
        to="/assessments"
        className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Back to Assessments
      </Link>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 p-4 pb-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/40">
            <AppIcon className="h-5 w-5 text-foreground" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-foreground">{application?.name ?? "—"}</p>
            <p className="text-xs text-muted-foreground">
              {application?.version ? `Version ${application.version}` : "—"}
              {application && (
                <>
                  {" · "}
                  <PlatformBadge platform={application.platform} />
                </>
              )}
            </p>
          </div>
        </div>

        <div className="px-4 pb-3">
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            {assessment.completed_tests} of {assessment.total_tests} tests completed
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="border-t border-border/70 px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Security Tests</h2>
        </div>

        {(risks ?? []).length === 0 ? (
          <p className="px-4 pb-4 text-center text-sm text-muted-foreground">
            No test catalogue returned by the automation backend for this platform.
          </p>
        ) : (
          <ul className="divide-y divide-border/70">
            {(risks ?? []).map((risk) => {
              const finding = findingByTestId.get(risk.risk_id);
              const isActive = risk.risk_id === activeTestId;
              const RiskIcon = riskIcon(risk.name);
              return (
                <li key={risk.risk_id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/assessments/${assessment.id}/tests/${risk.risk_id}`)}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-muted/60",
                      isActive && "bg-primary/5 ring-1 ring-inset ring-primary/30",
                    )}
                  >
                    <RiskIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {risk.name}
                    </span>
                    {finding ? (
                      <StatusBadge status={finding.status} />
                    ) : (
                      <Badge tone="neutral">Not Tested</Badge>
                    )}
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
