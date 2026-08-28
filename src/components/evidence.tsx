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
                <img src={item.url} alt={item.name} className="h-40 w-full object-cover" />
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
