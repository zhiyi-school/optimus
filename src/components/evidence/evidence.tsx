/**
 * Evidence lists and viewers with view and download actions.
 */

import { useId, useState } from "react";
import {
  Download,
  ExternalLink,
  File as FileIcon,
  FileText,
  Image as ImageIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/layout/page-blocks";
import { createDebug } from "@/lib/debug";
import { downloadFile } from "@/lib/download";
import { errorMessage, formatBytes } from "@/lib/utils";
import type { EvidenceItem } from "@/domain/evidence/evidence-types";

export type { EvidenceItem } from "@/domain/evidence/evidence-types";

const debug = createDebug("component:evidence");

/** How many rail items are shown before the reader asks for the rest. */
export const RAIL_COLLAPSED_ITEMS = 5;

/** Icon for an evidence kind: image, text-like or generic file. */
function iconFor(kind: string) {
  if (kind === "image") return ImageIcon;
  if (kind === "text" || kind === "log" || kind === "json") return FileText;
  return FileIcon;
}

/** Tracks evidence downloads through a Blob so a refused request is reported, not saved. */
function useDownload() {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);

  /** Downloads the item and records which item is busy or failed. */
  async function start(item: EvidenceItem) {
    if (!item.url) return;
    debug("downloads evidence", {
      id: item.id,
      fileName: item.downloadName ?? item.name,
      kind: item.kind,
    });
    setBusy(item.id);
    setFailed(null);
    try {
      await downloadFile(item.url, item.downloadName ?? item.name);
      debug("downloaded evidence", { id: item.id });
    } catch (error) {
      debug("evidence download fails", { id: item.id }, error);
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

/** Download button for an evidence item with a URL, optionally icon-only. */
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

/** Narrow evidence list for the rail, collapsed to the first few items until expanded. */
export function EvidenceList({ items }: { items: EvidenceItem[] }) {
  const { busy, failed, start } = useDownload();
  const [expanded, setExpanded] = useState(false);
  const listId = useId();

  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">No evidence recorded yet.</p>;
  }

  const hidden = items.length - RAIL_COLLAPSED_ITEMS;
  const visible = expanded ? items : items.slice(0, RAIL_COLLAPSED_ITEMS);

  return (
    <>
      <ul id={listId} className="divide-y divide-border/70">
        {visible.map((item) => {
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
                    onClick={() => debug("opens evidence", { id: item.id, kind: item.kind })}
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
                    onClick={() => {
                      debug("retries evidence download", { id: item.id });
                      void start(item);
                    }}
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
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => {
            debug("toggles evidence list", { expanded: !expanded, hidden });
            setExpanded((open) => !open);
          }}
          aria-expanded={expanded}
          aria-controls={listId}
          className="mt-2 rounded text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {expanded
            ? "Show fewer artifacts"
            : `Show ${hidden} more artifact${hidden === 1 ? "" : "s"}`}
        </button>
      )}
    </>
  );
}

/** Two-column grid of evidence cards with image previews, text excerpts and downloads. */
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
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`View ${item.name}`}
                onClick={() => debug("opens evidence", { id: item.id, kind: item.kind })}
              >
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
