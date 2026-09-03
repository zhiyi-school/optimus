import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Info, X, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface GuidedStep {
  id: string;
  label: string;
  complete?: boolean;
}

interface GuidedStepsProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  tip?: ReactNode;
  steps: GuidedStep[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Sits under the step list, e.g. an estimated-time card. */
  aside?: ReactNode;
  closeTo: string;
  closeLabel: string;
  navLabel: string;
  finishLabel?: string;
  children: ReactNode;
}

export function GuidedSteps({
  icon: Icon,
  title,
  description,
  tip,
  steps,
  activeId,
  onSelect,
  aside,
  closeTo,
  closeLabel,
  navLabel,
  finishLabel = "Done",
  children,
}: GuidedStepsProps) {
  const index = steps.findIndex((step) => step.id === activeId);
  const onFirst = index <= 0;
  const onLast = index === steps.length - 1;

  return (
    <Card className="mx-auto max-w-5xl">
      <CardContent className="p-4 pt-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-foreground">{title}</h1>
              {description && (
                <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
              )}
            </div>
          </div>
          <Link
            to={closeTo}
            aria-label={closeLabel}
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X className="h-4 w-4" />
          </Link>
        </div>

        {tip && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-primary/25 bg-primary/5 p-3 text-sm text-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">{tip}</div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <div className="space-y-3">
            <nav aria-label={navLabel}>
              <ol className="flex gap-2 overflow-x-auto pb-2 [scrollbar-gutter:stable] lg:flex-col lg:gap-0.5 lg:overflow-x-visible lg:pb-0">
                {steps.map((step, stepIndex) => {
                  const active = step.id === activeId;
                  return (
                    <li key={step.id} className="shrink-0 lg:shrink">
                      <button
                        type="button"
                        onClick={() => onSelect(step.id)}
                        aria-current={active ? "step" : undefined}
                        className={cn(
                          "flex min-h-[2.25rem] w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                          active
                            ? "bg-primary/10 font-medium text-primary"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                            step.complete
                              ? "bg-success text-white"
                              : active
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground",
                          )}
                        >
                          {step.complete ? <Check className="h-3 w-3" /> : stepIndex + 1}
                        </span>
                        <span className="min-w-0 flex-1 lg:whitespace-normal">{step.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </nav>
            {aside}
          </div>

          <div className="min-w-0 rounded-md border border-border/70 p-4">{children}</div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
          <Link to={closeTo}>
            <Button variant="outline" size="sm">
              {closeLabel}
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={onFirst}
              onClick={() => onSelect(steps[index - 1].id)}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Previous
            </Button>
            {onLast ? (
              <Link to={closeTo}>
                <Button size="sm">{finishLabel}</Button>
              </Link>
            ) : (
              <Button size="sm" onClick={() => onSelect(steps[index + 1].id)}>
                Next Step
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function EstimatedTime({ children }: { children: ReactNode }) {
  return (
    <div className="hidden rounded-md border border-border/70 bg-muted/40 p-3 lg:block">
      <p className="text-xs font-medium text-foreground">Estimated time</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{children}</p>
    </div>
  );
}
