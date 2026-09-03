import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, PlatformBadge } from "@/components/data-display";
import { riskIcon } from "@/lib/entity-icons";
import { ApplicationIcon } from "@/components/application-icon";
import { cn } from "@/lib/utils";
import type { Application } from "@/data/types";
import type { Tone } from "@/lib/status";
import { toneClasses } from "@/lib/status";

export interface RiskSidebarEntry {
  riskId: string;
  name: string;
  /** Finding classification when one exists; the row falls back to "Not Tested". */
  status?: "at_risk" | "reduced_risk" | "inconclusive";
  /** Role-specific second badge, e.g. the developer's remediation state. */
  note?: { label: string; tone: Tone };
}

interface RiskSidebarProps {
  backTo: string;
  backLabel: string;
  application: Application | null | undefined;
  progress: { completed: number; total: number; label: string };
  risks: RiskSidebarEntry[];
  activeRiskId?: string;
  riskHref: (riskId: string) => string;
  emptyMessage: string;
  heading?: string;
}

/**
 * The master column both roles share. Security passes the assessment's risk
 * catalogue; the developer passes the risks their findings cover.
 */
export function RiskSidebar({
  backTo,
  backLabel,
  application,
  progress,
  risks,
  activeRiskId,
  riskHref,
  emptyMessage,
  heading = "Security Tests",
}: RiskSidebarProps) {
  const navigate = useNavigate();
  const [openOnMobile, setOpenOnMobile] = useState(false);
  const pct =
    progress.total > 0 ? Math.min(100, Math.round((progress.completed / progress.total) * 100)) : 0;
  const activeName = risks.find((entry) => entry.riskId === activeRiskId)?.name;

  return (
    <div className="lg:sticky lg:top-20 lg:self-start">
      <Link
        to={backTo}
        className="mb-2.5 inline-flex items-center gap-1 rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        {backLabel}
      </Link>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2.5 p-3">
          <ApplicationIcon application={application} className="h-9 w-9" iconClassName="h-4 w-4" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {application?.name ?? "—"}
            </p>
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {application?.version ? `Version ${application.version}` : "Version unknown"}
              {application && <PlatformBadge platform={application.platform} />}
            </p>
          </div>
        </div>

        <div className="px-3 pb-3">
          <p className="mb-1 text-xs text-muted-foreground">
            {progress.completed} of {progress.total} {progress.label}
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Below lg the list is an accordion, so the detail pane is not pushed off-screen. */}
        <button
          type="button"
          onClick={() => setOpenOnMobile((open) => !open)}
          aria-expanded={openOnMobile}
          aria-controls="risk-sidebar-list"
          className="flex w-full items-center justify-between gap-2 border-t border-border/70 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 lg:pointer-events-none"
        >
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {heading}
          </h2>
          <span className="flex min-w-0 items-center gap-1.5 lg:hidden">
            <span className="min-w-0 truncate text-xs text-muted-foreground">{activeName}</span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                openOnMobile && "rotate-180",
              )}
            />
          </span>
        </button>

        {risks.length === 0 ? (
          <p className="px-3 pb-3 text-center text-xs text-muted-foreground">{emptyMessage}</p>
        ) : (
          <ul
            id="risk-sidebar-list"
            className={cn(
              "max-h-[22rem] divide-y divide-border/70 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable] lg:block lg:max-h-[calc(100vh-19rem)]",
              !openOnMobile && "hidden",
            )}
          >
            {risks.map((entry) => {
              const isActive = entry.riskId === activeRiskId;
              const RiskIcon = riskIcon(entry.name);
              return (
                <li key={entry.riskId}>
                  <button
                    type="button"
                    onClick={() => navigate(riskHref(entry.riskId))}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
                      isActive && "bg-primary/5 ring-1 ring-inset ring-primary/30",
                    )}
                  >
                    <RiskIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 text-sm font-medium leading-tight text-foreground line-clamp-2">
                      {entry.name}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      {entry.status ? (
                        <StatusBadge status={entry.status} />
                      ) : (
                        <Badge tone="neutral">Not Tested</Badge>
                      )}
                      {entry.note && (
                        <span
                          className={cn(
                            "rounded border px-1.5 py-0.5 text-[10px] font-medium",
                            toneClasses[entry.note.tone],
                          )}
                        >
                          {entry.note.label}
                        </span>
                      )}
                    </span>
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
