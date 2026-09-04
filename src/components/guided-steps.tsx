import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Clock, Info, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// A footer action that navigates is a link, so it must not wrap a real button.
const linkButton =
  "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
const linkButtonOutline = `${linkButton} border border-border bg-card text-foreground hover:bg-muted`;
const linkButtonPrimary = `${linkButton} bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow`;

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
  tipLabel?: string;
  /** A warning that must not be missed, shown above the tip. */
  notice?: ReactNode;
  steps: GuidedStep[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Sits under the step timeline, e.g. the estimated-time card. */
  aside?: ReactNode;
  /** Reference material, shown after the active step inside the content panel. */
  supporting?: ReactNode;
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
  tipLabel,
  notice,
  steps,
  activeId,
  onSelect,
  aside,
  supporting,
  closeTo,
  closeLabel,
  navLabel,
  finishLabel = "Done",
  children,
}: GuidedStepsProps) {
  const index = steps.findIndex((step) => step.id === activeId);
  const onFirst = index <= 0;
  const onLast = index === steps.length - 1;
  // Loading, error and step-less controls keep the shell; only the walk-through goes.
  const guided = steps.length > 0;

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div
      data-guided-backdrop
      className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/50 backdrop-blur-[1px]"
    >
      <div
        data-guided-card
        className="flex h-[94vh] w-[94vw] max-w-7xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card-hover"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 py-4 sm:px-6 sm:py-5">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight text-foreground">{title}</h1>
              {description && (
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              )}
            </div>
          </div>
          <Link
            to={closeTo}
            aria-label={closeLabel}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X className="h-5 w-5" />
          </Link>
        </div>

        <div
          data-guided-body
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 pb-5 sm:px-6 sm:pb-6"
        >
          {notice && <div className="mb-4">{notice}</div>}

          {tip && (
            <div className="mb-5 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1 text-sm text-foreground">
                {tipLabel && <p className="font-semibold">{tipLabel}</p>}
                <div className={cn(tipLabel && "mt-1 text-muted-foreground")}>{tip}</div>
              </div>
            </div>
          )}

          <div
            className={cn(
              "grid grid-cols-1 gap-5",
              guided && "lg:grid-cols-[14rem_minmax(0,1fr)]",
            )}
          >
            {guided && (
              <div className="space-y-4">
                <nav aria-label={navLabel}>
                  <ol className="flex gap-2 overflow-x-auto pb-2 [scrollbar-gutter:stable] lg:flex-col lg:gap-1 lg:overflow-x-visible lg:pb-0">
                    {steps.map((step, stepIndex) => {
                      const active = step.id === activeId;
                      return (
                        <li key={step.id} className="shrink-0 lg:shrink">
                          <button
                            type="button"
                            onClick={() => onSelect(step.id)}
                            aria-current={active ? "step" : undefined}
                            className={cn(
                              "relative flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                              active
                                ? "bg-primary/10 font-semibold text-primary"
                                : "text-foreground hover:bg-muted",
                            )}
                          >
                            {stepIndex < steps.length - 1 && (
                              <span
                                aria-hidden
                                data-guided-connector
                                className="absolute bottom-[-0.875rem] left-[1.625rem] top-[2.375rem] hidden w-px -translate-x-1/2 bg-border lg:block"
                              />
                            )}
                            <span
                              data-guided-marker
                              className={cn(
                                "relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                                step.complete
                                  ? "bg-success text-white"
                                  : active
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-muted-foreground",
                              )}
                            >
                              {step.complete ? <Check className="h-3.5 w-3.5" /> : stepIndex + 1}
                            </span>
                            <span className="min-w-0 flex-1 pt-1 leading-snug lg:whitespace-normal">
                              {step.label}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </nav>
                {aside}
              </div>
            )}

            <div
              data-guided-panel
              className="min-w-0 space-y-5 rounded-xl border border-border bg-card p-5"
            >
              {children}
              {supporting}
            </div>
          </div>
        </div>

        <div
          data-guided-footer
          className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border bg-card px-5 py-3.5 sm:px-6 sm:py-4"
        >
          <Link to={closeTo} className={linkButtonOutline}>
            Cancel
          </Link>
          {guided && (
            <div className="flex items-center gap-2">
              {!onFirst && (
                <Button variant="outline" onClick={() => onSelect(steps[index - 1].id)}>
                  <ArrowLeft className="h-4 w-4" />
                  Previous
                </Button>
              )}
              {onLast ? (
                <Link to={closeTo} className={linkButtonPrimary}>
                  {finishLabel}
                </Link>
              ) : (
                <Button onClick={() => onSelect(steps[index + 1].id)}>
                  Next Step
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function EstimatedTime({ value }: { value: ReactNode }) {
  return (
    <div
      data-guided-aside
      className="hidden items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-3 lg:flex"
    >
      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">Estimated time</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{value}</p>
      </div>
    </div>
  );
}
