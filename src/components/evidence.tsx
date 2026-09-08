import { useState } from "react";
import {
  Download,
  ExternalLink,
  File as FileIcon,
  FileText,
  Image as ImageIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common";
import { downloadFile } from "@/lib/download";
import { errorMessage, formatBytes } from "@/lib/utils";

export interface EvidenceItem {
  id: string;
  name: string;
  kind: string;
  url?: string;
  textContent?: string | null;
  source?: string;
  /** The name the saved file should take; without it the URL decides. */
  downloadName?: string;
  sizeBytes?: number;
}

function iconFor(kind: string) {
  if (kind === "image") return ImageIcon;
  if (kind === "text" || kind === "log" || kind === "json") return FileText;
  return FileIcon;
}

/** Saves through a Blob, so a refused request is reported rather than written to disk. */
function useDownload() {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);

  async function start(item: EvidenceItem) {
    if (!item.url) return;
    setBusy(item.id);
    setFailed(null);
    try {
      await downloadFile(item.url, item.downloadName ?? item.name);
    } catch (error) {
      setFailed({
        id: item.id,
        message: errorMessage(error, "That file could not be downloaded."),
      });
    } finally {
      setBusy(null);
    }
  }

  return { busy, failed, start };
}

function DownloadButton({
  item,
  busy,
  onDownload,
  compact = false,
}: {
  item: EvidenceItem;
  busy: boolean;
  onDownload: (item: EvidenceItem) => void;
  compact?: boolean;
}) {
  if (!item.url) return null;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onDownload(item)}
      aria-label={`Download ${item.downloadName ?? item.name}`}
      className="inline-flex shrink-0 items-center gap-1 rounded text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-progress disabled:opacity-60"
    >
      <Download className="h-3.5 w-3.5" />
      {compact ? "" : busy ? "Downloading…" : "Download"}
    </button>
  );
}

/** The rail lists evidence in one narrow column; the full-width view keeps the two-up grid. */
export function EvidenceList({ items }: { items: EvidenceItem[] }) {
  const { busy, failed, start } = useDownload();

  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">No evidence recorded yet.</p>;
  }
  return (
    <ul className="divide-y divide-border/70">
      {items.map((item) => {
        const Icon = iconFor(item.kind);
        return (
          <li key={item.id} className="py-2">
            <div className="flex items-center gap-2.5">
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
                <span className="block truncate text-xs font-medium text-foreground">
                  {item.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[item.source, item.sizeBytes ? formatBytes(item.sizeBytes) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              {item.url && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`View ${item.name}`}
                  className="shrink-0 rounded text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              <DownloadButton item={item} busy={busy === item.id} onDownload={start} compact />
            </div>
            {failed?.id === item.id && (
              <p className="mt-1 text-xs text-danger">
                {failed.message}{" "}
                <button
                  type="button"
                  onClick={() => start(item)}
                  className="rounded font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  Try again
                </button>
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function EvidenceViewer({ items }: { items: EvidenceItem[] }) {
  const { busy, failed, start } = useDownload();

  if (items.length === 0) {
    return <EmptyState title="No evidence recorded yet." />;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {items.map((item) => {
        const Icon = iconFor(item.kind);
        const meta = [item.source, item.sizeBytes ? formatBytes(item.sizeBytes) : null]
          .filter(Boolean)
          .join(" · ");
        const error = failed?.id === item.id ? failed.message : null;

        if (item.kind === "image" && item.url) {
          return (
            <Card key={item.id} className="overflow-hidden">
              <a href={item.url} target="_blank" rel="noreferrer" aria-label={`View ${item.name}`}>
                <img src={item.url} alt={item.name} className="h-28 w-full object-cover" />
              </a>
              <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
                <span className="min-w-0 truncate">{item.name}</span>
                <DownloadButton item={item} busy={busy === item.id} onDownload={start} />
              </div>
              {meta && <p className="px-3 pb-2 text-xs text-muted-foreground">{meta}</p>}
              {error && <p className="px-3 pb-2 text-xs text-danger">{error}</p>}
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
              {meta && <p className="mt-1 text-xs text-muted-foreground">{meta}</p>}
              {error && <p className="mt-1 text-xs text-danger">{error}</p>}
            </div>
            <DownloadButton item={item} busy={busy === item.id} onDownload={start} />
          </Card>
        );
      })}
    </div>
  );
}
