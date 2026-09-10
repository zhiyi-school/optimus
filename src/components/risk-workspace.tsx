import { type ReactNode } from "react";
import { Paperclip, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { plainText } from "@/lib/inline-markdown";
import { cn } from "@/lib/utils";

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
          <h1 className="text-base font-semibold text-foreground">{plainText(name)}</h1>
          {badges}
        </div>
        {description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{plainText(description)}</p>
        )}
        {meta && <div className="mt-1 text-xs text-muted-foreground">{meta}</div>}
      </div>
    </div>
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
