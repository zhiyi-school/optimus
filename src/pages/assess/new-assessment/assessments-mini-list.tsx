/**
 * Side list of the latest assessment per application beside the new assessment form.
 */

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { LoadingState } from "@/components/layout/page-blocks";
import { AssessmentStatusBadge, PlatformBadge } from "@/components/shared/badges-and-table";
import { ApplicationIcon } from "@/components/shared/application-icon";
import { useAssessments } from "@/hooks/queries/assessments";
import { latestAssessmentPerApp } from "@/domain/assessment/assessments";
import { formatDate } from "@/lib/utils";

/** Lists the latest assessment per app, linking completed ones to their detail page. */
export function AssessmentsMiniList() {
  const { data, isLoading } = useAssessments();
  const assessments = useMemo(() => latestAssessmentPerApp(data), [data]);

  return (
    <div className="lg:contents">
      <div className="shrink-0">
        <h2 className="text-lg font-bold text-foreground">Assessments</h2>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">Select an application assessment to continue.</p>
      </div>

      {isLoading && <LoadingState label="Loading…" />}
      {!isLoading && assessments.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">No assessments yet.</p>
      )}
      {!isLoading && assessments.length > 0 && (
        <ul className="max-h-[22rem] divide-y divide-border overflow-y-auto overflow-x-hidden pr-3 [scrollbar-gutter:stable] lg:min-h-0 lg:max-h-none lg:flex-1">
          {assessments.map((a) => {
            const pct =
              a.total_tests > 0 ? Math.min(100, Math.round((a.completed_tests / a.total_tests) * 100)) : 0;
            const navigable = a.status === "completed";
            const rowContent = (
              <>
                <ApplicationIcon application={a.application} />
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">
                      {a.application?.name ?? "—"}
                    </span>
                    {a.application && (
                      <span className="shrink-0">
                        <PlatformBadge platform={a.application.platform} />
                      </span>
                    )}
                  </div>
                  <p className="mb-1 truncate text-xs text-muted-foreground">
                    {a.completed_tests} of {a.total_tests}
                  </p>
                  <div className="mb-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                    <AssessmentStatusBadge status={a.status} />
                    <span className="truncate text-xs text-muted-foreground">
                      {formatDate(a.created_at)}
                    </span>
                  </div>
                </div>
              </>
            );
            return (
              <li key={a.id}>
                {navigable ? (
                  <Link
                    to={`/assessments/${a.id}`}
                    className="flex items-center gap-3 rounded-lg px-2 py-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {rowContent}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 rounded-lg px-2 py-3">{rowContent}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
