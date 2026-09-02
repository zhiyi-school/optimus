import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, CircleDot } from "lucide-react";
import { EmptyState } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { ProgressBar, ToneBadge } from "@/components/resolve-display";
import type { ControlProgressStatus } from "@/data/types";
import { controlStatusLabels, type LiveControl } from "@/lib/resolve";

const statusIcon: Record<ControlProgressStatus, typeof Circle> = {
  not_started: Circle,
  in_progress: CircleDot,
  completed: CheckCircle2,
  needs_changes: AlertTriangle,
};

const iconTone: Record<ControlProgressStatus, string> = {
  not_started: "text-muted-foreground",
  in_progress: "text-primary",
  completed: "text-success",
  needs_changes: "text-danger",
};

export function ControlChecklist({
  controls,
  linkTo,
  unavailable = false,
  emptyMessage = "No remediation controls are linked to this risk yet.",
}: {
  controls: LiveControl[];
  linkTo: (controlId: string) => string;
  unavailable?: boolean;
  emptyMessage?: string;
}) {
  if (unavailable) {
    return (
      <EmptyState
        title="Remediation instructions are unavailable"
        description="The automation backend could not provide the controls for this risk, so there is nothing to show. Your recorded progress is safe."
      />
    );
  }
  if (controls.length === 0) return <EmptyState title={emptyMessage} />;

  return (
    <ul className="space-y-2">
      {controls.map(({ definition, status, progress }) => {
        const presentation = controlStatusLabels[status];
        const Icon = statusIcon[status];
        const href = linkTo(definition.control_id);

        return (
          <li key={definition.control_id}>
            <Link
              to={href}
              aria-label={`View steps for ${definition.title}`}
              className="group block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Card className="transition-colors group-hover:border-primary/40 group-focus-visible:border-primary/40">
                <CardContent className="py-3">
                  <div className="flex items-start gap-3">
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconTone[status]}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-foreground group-hover:text-primary">
                          {definition.title}
                        </p>
                        <ToneBadge tone={presentation.tone} label={presentation.label} />
                      </div>
                      {definition.summary && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {definition.summary}
                        </p>
                      )}
                      <div className="mt-2">
                        <ProgressBar label="Steps completed" progress={progress} />
                      </div>
                      <div className="mt-2 flex justify-end">
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary group-hover:underline">
                          View steps
                          <ArrowRight className="h-3 w-3" />
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
