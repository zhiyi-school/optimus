import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Inbox, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
  to,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "neutral" | "danger" | "success" | "warning" | "info";
  /** When set, the whole card links there — e.g. a finding-status count
   *  linking to that filtered view on the Findings page. */
  to?: string;
}) {
  const valueTone: Record<string, string> = {
    neutral: "text-foreground",
    danger: "text-danger",
    success: "text-success",
    warning: "text-warning",
    info: "text-primary",
  };
  const body = (
    <CardContent className="py-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={cn("mt-2 text-3xl font-bold tracking-tight", valueTone[tone])}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </CardContent>
  );
  if (to) {
    return (
      <Link to={to} className="block">
        <Card className="transition-all hover:border-primary/40 hover:shadow-card-hover">{body}</Card>
      </Link>
    );
  }
  return <Card>{body}</Card>;
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function ErrorState({
  message = "Something went wrong.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-danger/20 bg-danger/5 py-16 text-center">
      <AlertTriangle className="h-5 w-5 text-danger" />
      <p className="text-sm text-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
      <Inbox className="h-5 w-5 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      )}
      {action}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative w-full max-w-xs">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-8"
      />
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">{children}</div>
  );
}

export function DismissibleBanner({
  message,
  action,
  onDismiss,
  tone = "info",
}: {
  message: ReactNode;
  action?: ReactNode;
  onDismiss: () => void;
  tone?: "info" | "success";
}) {
  const toneClass =
    tone === "success"
      ? "border-success/20 bg-success/5 text-success"
      : "border-primary/20 bg-primary/5 text-primary";
  return (
    <div className={cn("mb-4 flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm", toneClass)}>
      <span className="text-foreground">{message}</span>
      <div className="flex shrink-0 items-center gap-3">
        {action}
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
