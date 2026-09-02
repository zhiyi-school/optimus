import { Link } from "react-router-dom";
import { ArrowRight, BookOpen } from "lucide-react";
import { EmptyState } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { ToneBadge } from "@/components/resolve-display";
import { isRequiredControl, playbookControlStatusLabels } from "@/lib/resolve";
import type { ControlDetail } from "@/api/playbook-types";

export function ControlDefinitionList({
  controls,
  linkTo,
  emptyMessage = "The playbook has no developer controls for this risk yet.",
}: {
  controls: ControlDetail[] | undefined;
  linkTo: (controlId: string) => string;
  emptyMessage?: string;
}) {
  if (!controls || controls.length === 0) return <EmptyState title={emptyMessage} />;

  return (
    <ul className="space-y-2">
      {controls.map((control) => {
        const status = playbookControlStatusLabels[control.status];
        const required = isRequiredControl(control);
        return (
          <li key={control.control_id}>
            <Link
              to={linkTo(control.control_id)}
              aria-label={`View remediation steps for ${control.title}`}
              className="group block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Card className="transition-colors group-hover:border-primary/40 group-focus-visible:border-primary/40">
                <CardContent className="py-3">
                  <div className="flex items-start gap-3">
                    <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-foreground group-hover:text-primary">
                          {control.title}
                        </p>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <ToneBadge tone={status.tone} label={status.label} />
                          <ToneBadge
                            tone={required ? "warning" : "neutral"}
                            label={required ? "Required" : "Optional"}
                          />
                        </span>
                      </div>
                      {control.summary && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {control.summary}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">
                          {control.step_count === 1 ? "1 step" : `${control.step_count} steps`}
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary group-hover:underline">
                          View remediation steps
                          <ArrowRight className="h-3 w-3" />
                        </span>
                      </div>
                      {!required && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Not counted as required remediation work.
                        </p>
                      )}
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
