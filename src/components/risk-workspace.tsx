import { type ReactNode } from "react";
import { Paperclip, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/data-display";
import { cn, formatDate } from "@/lib/utils";
import type { Finding } from "@/data/types";

/** Sidebar plus detail column. Security and the developer share this geometry exactly. */
export function RiskWorkspace({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
      {sidebar}
      <div className="min-w-0 space-y-4">{children}</div>
    </div>
  );
}

/** The finding and its actions, with the evidence rail beside them where there is room. */
export function RiskDetailGrid({ rail, children }: { rail?: ReactNode; children: ReactNode }) {
  return (
    <div className={cn("grid grid-cols-1 gap-4", rail && "xl:grid-cols-[minmax(0,1fr)_17rem]")}>
      <div className="min-w-0 space-y-4">{children}</div>
      {rail}
    </div>
  );
}

export function RiskHeader({
  icon: Icon,
  name,
  description,
  badges,
  meta,
}: {
  icon: LucideIcon;
  name: string;
  description?: string | null;
  badges?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className="h-4 w-4 text-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-base font-semibold text-foreground">{name}</h1>
          {badges}
        </div>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        {meta && <div className="mt-1 text-xs text-muted-foreground">{meta}</div>}
      </div>
    </div>
  );
}

export function FindingSummary({
  finding,
  emptyDescription = "Security has not recorded a description for this finding.",
}: {
  finding: Finding | undefined;
  emptyDescription?: string;
}) {
  if (!finding) return null;
  return (
    <Card>
      <CardContent className="space-y-2 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">What was found</h2>
          <span className="text-xs text-muted-foreground">
            Found {formatDate(finding.created_at)}
          </span>
        </div>
        <p className="text-sm text-foreground">{finding.description || emptyDescription}</p>
        {finding.impact && (
          <>
            <p className="pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Why it matters
            </p>
            <p className="text-sm text-foreground">{finding.impact}</p>
          </>
        )}
        <p className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
          Current classification <StatusBadge status={finding.status} />
        </p>
      </CardContent>
    </Card>
  );
}

export function EvidenceRail({
  title = "Evidence",
  count,
  children,
}: {
  title?: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <Card className="h-fit xl:sticky xl:top-20">
      <CardContent className="py-3.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {count !== undefined && count > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Paperclip className="h-3 w-3" />
              {count === 1 ? "1 item" : `${count} items`}
            </span>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

/** A titled block that is not another card, so sections stop nesting cards inside cards. */
export function WorkspaceSection({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {aside && <div className="min-w-[10rem] flex-1">{aside}</div>}
      </div>
      {children}
    </section>
  );
}
