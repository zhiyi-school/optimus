/**
 * The app's assessments, newest first, each with the version it tested, and the action to assess a new version.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PackagePlus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AssessmentStatusBadge } from "@/components/shared/badges-and-table";
import { NewVersionDialog } from "@/components/assessment/new-version-dialog";
import { visibleHistory } from "@/domain/assessment/assessments";
import { createDebug } from "@/lib/debug";
import { cn, formatDate } from "@/lib/utils";
import type { Application, Assessment } from "@/database/types";

const debug = createDebug("components:assessment:assessment-history");

/** Lists the application's assessments newest first with their tested versions, linking each, and offers a new one. */
export function AssessmentHistory({
  application,
  currentAssessmentId,
  assessments: unordered,
  mayStart,
}: {
  application: Application | null | undefined;
  currentAssessmentId: string;
  assessments: Assessment[];
  mayStart: boolean;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const assessments = useMemo(
    () => [...unordered].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [unordered],
  );

  if (!application || (assessments.length <= 1 && !mayStart)) return null;
  const { shown, hidden } = visibleHistory(assessments, currentAssessmentId, expanded);

  return (
    <Card className="mt-3 overflow-hidden">
      <h2 className="border-b border-border/70 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Assessments
      </h2>
      <ul className="divide-y divide-border/70">
        {shown.map((assessment) => {
          const current = assessment.id === currentAssessmentId;
          return (
            <li key={assessment.id}>
              <Link
                to={`/assessments/${encodeURIComponent(assessment.id)}`}
                aria-current={current ? "page" : undefined}
                onClick={() => debug("opens assessment from history", { assessmentId: assessment.id })}
                className={cn(
                  "flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted/60",
                  current && "bg-primary/5",
                )}
              >
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">
                    {assessment.app_version ? `Version ${assessment.app_version}` : "Version not recorded"}
                  </span>
                  <span className="block text-xs text-muted-foreground">{formatDate(assessment.created_at)}</span>
                </span>
                <AssessmentStatusBadge status={assessment.status} />
              </Link>
            </li>
          );
        })}
      </ul>
      {(hidden > 0 || expanded) && (
        <button
          type="button"
          className="w-full border-t border-border/70 px-3 py-2 text-xs font-medium text-primary hover:bg-muted/60"
          onClick={() => {
            debug("toggles assessment history", { expanded: !expanded });
            setExpanded(!expanded);
          }}
        >
          {expanded ? "Show fewer" : `Show all ${assessments.length}`}
        </button>
      )}
      {mayStart && (
        <div className="border-t border-border/70 p-3">
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => {
              debug("opens new version dialog", { applicationId: application.id });
              setDialogOpen(true);
            }}
          >
            <PackagePlus className="h-3.5 w-3.5" />
            Assess a new version
          </Button>
          {dialogOpen && (
            <NewVersionDialog application={application} open={dialogOpen} onOpenChange={setDialogOpen} />
          )}
        </div>
      )}
    </Card>
  );
}
