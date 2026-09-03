import { Fragment, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Circle, Smartphone, Apple } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  findingStatusConfig,
  severityLabelOf,
  severityToneOf,
  ticketStatusConfig,
  testRunStatusConfig,
  assessmentStatusConfig,
} from "@/lib/status";
import type { FindingStatus, TicketStatus, Platform } from "@/data/types";

export function StatusBadge({ status }: { status: FindingStatus }) {
  const config = findingStatusConfig[status];
  return <Badge tone={config.tone}>{config.label}</Badge>;
}

export function SeverityBadge({ severity }: { severity: string | null | undefined }) {
  return <Badge tone={severityToneOf(severity)}>{severityLabelOf(severity)}</Badge>;
}

export function PlatformBadge({ platform }: { platform: Platform | string }) {
  const Icon = platform === "ios" ? Apple : Smartphone;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
      {platform === "ios" ? "iOS" : "Android"}
    </span>
  );
}

export function TicketBadge({ status }: { status: TicketStatus }) {
  const config = ticketStatusConfig[status];
  return <Badge tone={config.tone}>{config.label}</Badge>;
}

export function TestRunStatusBadge({ status }: { status: string }) {
  const config = testRunStatusConfig[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={config.tone}>{config.label}</Badge>;
}

export function AssessmentStatusBadge({ status }: { status: string }) {
  const config = assessmentStatusConfig[status] ?? { label: status, tone: "neutral" as const };
  return (
    <Badge tone={config.tone}>
      {status === "running" && <Circle className="h-2.5 w-2.5" />}
      {config.label}
    </Badge>
  );
}

export function ProgressBar({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {value} / {total}
      </span>
    </div>
  );
}

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  onRowClick,
  rowLabel,
  expandedRowId,
  onToggleExpand,
  renderExpanded,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  rowLabel?: (row: T) => string;
  /** Id of the row currently expanded, if any — pairs with `renderExpanded`. */
  expandedRowId?: string | null;
  onToggleExpand?: (row: T) => void;
  /** An expandable row still navigates on click; the chevron is its own control. */
  renderExpanded?: (row: T) => ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border/70 bg-card shadow-card">
      <table className="w-full border-collapse text-sm">
        <thead className="border-b border-border/70">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {col.header}
              </th>
            ))}
            {(onRowClick || renderExpanded) && <th className="w-8" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {rows.map((row) => {
            const expandedContent = renderExpanded?.(row);
            const isExpanded = !!expandedContent && expandedRowId === row.id;
            return (
              <Fragment key={row.id}>
                <tr
                  onClick={() => onRowClick?.(row)}
                  onKeyDown={(event) => {
                    if (!onRowClick) return;
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    onRowClick(row);
                  }}
                  tabIndex={onRowClick ? 0 : undefined}
                  role={onRowClick ? "link" : undefined}
                  aria-label={onRowClick ? rowLabel?.(row) : undefined}
                  className={cn(
                    "transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                    onRowClick && "cursor-pointer",
                  )}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={cn("px-4 py-3 align-middle", col.className)}>
                      {col.render(row)}
                    </td>
                  ))}
                  {(onRowClick || renderExpanded) && (
                    <td className="px-2 align-middle text-muted-foreground">
                      {expandedContent ? (
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          aria-label={isExpanded ? "Hide details" : "Show details"}
                          onClick={(event) => {
                            event.stopPropagation();
                            onToggleExpand?.(row);
                          }}
                          className="rounded p-1 hover:bg-muted hover:text-foreground"
                        >
                          <ChevronDown
                            className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-180")}
                          />
                        </button>
                      ) : onRowClick ? (
                        <ChevronRight className="h-4 w-4" />
                      ) : null}
                    </td>
                  )}
                </tr>
                {isExpanded && (
                  <tr>
                    <td colSpan={columns.length + 1} className="border-t border-primary/20 bg-primary/5 p-4">
                      {expandedContent}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
