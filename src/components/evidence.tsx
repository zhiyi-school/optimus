import { FileText, Image as ImageIcon, File as FileIcon, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common";

export interface EvidenceItem {
  id: string;
  name: string;
  kind: string;
  url?: string;
  textContent?: string | null;
  source?: string;
}

function iconFor(kind: string) {
  if (kind === "image") return ImageIcon;
  if (kind === "text" || kind === "log" || kind === "json") return FileText;
  return FileIcon;
}

/** The rail lists evidence in one narrow column; the full-width view keeps the two-up grid. */
export function EvidenceList({ items }: { items: EvidenceItem[] }) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">No evidence recorded yet.</p>;
  }
  return (
    <ul className="divide-y divide-border/70">
      {items.map((item) => {
        const Icon = iconFor(item.kind);
        const body = (
          <>
            {item.kind === "image" && item.url ? (
              <img
                src={item.url}
                alt={item.name}
                className="h-9 w-9 shrink-0 rounded border border-border object-cover"
              />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border bg-muted/40">
                <Icon className="h-4 w-4 text-muted-foreground" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-foreground">{item.name}</span>
              {item.source && (
                <span className="block truncate text-xs text-muted-foreground">{item.source}</span>
              )}
            </span>
          </>
        );
        return (
          <li key={item.id}>
            {item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2.5 py-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {body}
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </a>
            ) : (
              <div className="flex items-center gap-2.5 py-2">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function EvidenceViewer({ items }: { items: EvidenceItem[] }) {
  if (items.length === 0) {
    return <EmptyState title="No evidence recorded yet." />;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {items.map((item) => {
        const Icon = iconFor(item.kind);
        if (item.kind === "image" && item.url) {
          return (
            <Card key={item.id} className="overflow-hidden">
              <a href={item.url} target="_blank" rel="noreferrer">
                <img src={item.url} alt={item.name} className="h-28 w-full object-cover" />
              </a>
              <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
                <span className="truncate">{item.name}</span>
                {item.source && <span className="shrink-0">{item.source}</span>}
              </div>
            </Card>
          );
        }
        return (
          <Card key={item.id} className="flex items-start gap-3 p-3">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{item.name}</p>
              {item.textContent && (
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs text-muted-foreground">
                  {item.textContent}
                </pre>
              )}
              {item.source && (
                <p className="mt-1 text-xs text-muted-foreground">{item.source}</p>
              )}
            </div>
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-muted-foreground hover:text-primary"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </Card>
        );
      })}
    </div>
  );
}
