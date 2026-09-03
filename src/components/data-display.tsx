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

/** What the whole row does on click/Enter/Space: open results, toggle expanded status, or nothing. */
export type DataTableRowActivation = "navigate" | "expand" | "none";

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  onRowClick,
  rowLabel,
  rowActivation,
  expandedRowId,
  onToggleExpand,
  renderExpanded,
  expandLabel,
  renderCard,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  rowLabel?: (row: T) => string;
  /** Per-row activation mode. Omit to navigate on every row that has `onRowClick` (the old default). */
  rowActivation?: (row: T) => DataTableRowActivation;
  /** Id of the row currently expanded, if any — pairs with `renderExpanded`. */
  expandedRowId?: string | null;
  onToggleExpand?: (row: T) => void;
  renderExpanded?: (row: T) => ReactNode;
  /** Accessible label for an "expand" row; falls back to "Show/Hide details". */
  expandLabel?: (row: T) => string;
  /** Below `md` the columns stop fitting, so the same rows render as cards instead. */
  renderCard?: (row: T) => ReactNode;
}) {
  const activationOf = (row: T): DataTableRowActivation =>
    rowActivation ? rowActivation(row) : onRowClick ? "navigate" : "none";
  const hasTrailingColumn = !!onRowClick || !!renderExpanded || !!rowActivation;

  if (renderCard) {
    return (
      <>
        <ul className="space-y-2 md:hidden">
          {rows.map((row) => {
            const activation = activationOf(row);
            const expandedContent = activation === "expand" ? renderExpanded?.(row) : undefined;
            const isExpanded = activation === "expand" && expandedRowId === row.id;
            return (
              <li key={row.id}>
                {activation === "navigate" ? (
                  <button
                    type="button"
                    onClick={() => onRowClick?.(row)}
                    aria-label={rowLabel?.(row)}
                    className="flex w-full items-center gap-3 rounded-xl border border-border/70 bg-card p-3 text-left shadow-card transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <span className="min-w-0 flex-1">{renderCard(row)}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                ) : activation === "expand" ? (
                  <div className="rounded-xl border border-border/70 bg-card shadow-card">
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      aria-label={expandLabel?.(row) ?? (isExpanded ? "Hide details" : "Show details")}
                      onClick={() => onToggleExpand?.(row)}
                      className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
                    >
                      <span className="min-w-0 flex-1">{renderCard(row)}</span>
                      <ChevronDown
                        aria-hidden="true"
                        className={cn(
                          "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                          isExpanded && "rotate-180",
                        )}
                      />
                    </button>
                    {isExpanded && (
                      <div className="border-t border-primary/20 bg-primary/5 p-3">{expandedContent}</div>
                    )}
                  </div>
                ) : (
                  <div className="flex w-full items-center gap-3 rounded-xl border border-border/70 bg-card p-3 shadow-card">
                    <span className="min-w-0 flex-1">{renderCard(row)}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div className="hidden md:block">
          <DataTable
            columns={columns}
            rows={rows}
            onRowClick={onRowClick}
            rowLabel={rowLabel}
            rowActivation={rowActivation}
            expandedRowId={expandedRowId}
            onToggleExpand={onToggleExpand}
            renderExpanded={renderExpanded}
            expandLabel={expandLabel}
          />
        </div>
      </>
    );
  }

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
            {hasTrailingColumn && <th className="w-8" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {rows.map((row) => {
            const activation = activationOf(row);
            const isLink = activation === "navigate";
            const isExpandable = activation === "expand";
            const expandedContent = isExpandable ? renderExpanded?.(row) : undefined;
            const isExpanded = isExpandable && expandedRowId === row.id;
            const activate = () => {
              if (isLink) onRowClick?.(row);
              else if (isExpandable) onToggleExpand?.(row);
            };
            return (
              <Fragment key={row.id}>
                <tr
                  onClick={activation === "none" ? undefined : activate}
                  onKeyDown={(event) => {
                    if (activation === "none") return;
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    activate();
                  }}
                  tabIndex={activation === "none" ? undefined : 0}
                  role={isLink ? "link" : isExpandable ? "button" : undefined}
                  aria-expanded={isExpandable ? isExpanded : undefined}
                  aria-label={
                    isLink
                      ? rowLabel?.(row)
                      : isExpandable
                        ? (expandLabel?.(row) ?? (isExpanded ? "Hide details" : "Show details"))
                        : undefined
                  }
                  className={cn(
                    "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                    activation !== "none" && "cursor-pointer hover:bg-muted/60",
                  )}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={cn("px-4 py-3 align-middle", col.className)}>
                      {col.render(row)}
                    </td>
                  ))}
                  {hasTrailingColumn && (
                    <td className="px-2 align-middle text-muted-foreground">
                      {isExpandable ? (
                        <ChevronDown
                          aria-hidden="true"
                          className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-180")}
                        />
                      ) : isLink ? (
                        <ChevronRight aria-hidden="true" className="h-4 w-4" />
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
