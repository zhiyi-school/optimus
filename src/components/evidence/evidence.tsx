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
  Maximize2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/layout/page-blocks";
import { createDebug } from "@/lib/debug";
import { downloadFile } from "@/lib/download";
import { errorMessage, formatBytes } from "@/lib/utils";
import type { EvidenceItem } from "@/domain/evidence/evidence-types";

export type { EvidenceItem } from "@/domain/evidence/evidence-types";

const debug = createDebug("components:evidence:evidence");

/** How many rail items are shown before the reader asks for the rest. */
export const RAIL_COLLAPSED_ITEMS = 5;

/**
 * Fits a screenshot whole inside one square bound, never enlarging it: portrait and landscape
 * captures come out at the same scale whatever their resolution, and small images keep their size.
 * The width cap sits on the card, because a card sized to its content ignores the image's
 * percentage cap and would stretch to a wide image's full file width.
 */
const EVIDENCE_IMAGE_CARD = "w-fit min-w-[12rem] max-w-[min(100%,40rem,75vh)]";
const EVIDENCE_IMAGE_FIT = "h-auto w-auto max-h-[min(40rem,75vh)] max-w-full object-contain";

/** Opens an evidence screenshot in a dialog, as large as the window allows. */
function ImagePreview({ item, onClose }: { item: EvidenceItem | null; onClose: () => void }) {
  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {item?.url && (
        // w-max: a fixed panel offset by left-1/2 would otherwise shrink to half the window.
        <DialogContent className="w-max max-w-[95vw]">
          <DialogTitle className="mb-3 pr-6 text-sm">{item.name}</DialogTitle>
          <img
            src={item.url}
            alt={item.name}
            className="mx-auto h-auto max-h-[calc(90vh-5rem)] w-auto max-w-[calc(95vw-2.5rem)] object-contain"
          />
        </DialogContent>
      )}
    </Dialog>
  );
}

/** Tracks which evidence screenshot, if any, is open in the preview dialog. */
function usePreview() {
  const [previewing, setPreviewing] = useState<EvidenceItem | null>(null);

  /** Opens the item's screenshot in the preview dialog. */
  function open(item: EvidenceItem) {
    debug("previews evidence", { id: item.id });
    setPreviewing(item);
  }

  return { previewing, open, close: () => setPreviewing(null) };
}

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
  const preview = usePreview();
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
                  <button
                    type="button"
                    onClick={() => preview.open(item)}
                    aria-label={`Preview ${item.name}`}
                    className="shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <img
                      src={item.url}
                      alt=""
                      className="h-9 w-9 rounded border border-border object-cover"
                    />
                  </button>
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
                {item.kind === "image" && item.url ? (
                  <button
                    type="button"
                    onClick={() => preview.open(item)}
                    aria-label={`View ${item.name}`}
                    className="shrink-0 rounded text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </button>
                ) : item.url && (
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
      <ImagePreview item={preview.previewing} onClose={preview.close} />
    </>
  );
}

/** Evidence cards: screenshots sized to fit, opening full size, beside text excerpts and downloads. */
export function EvidenceViewer({ items }: { items: EvidenceItem[] }) {
  const { busy, failed, start } = useDownload();
  const preview = usePreview();

  if (items.length === 0) {
    return <EmptyState title="No evidence recorded yet." />;
  }

  return (
    <div className="flex flex-wrap items-start gap-3">
      {items.map((item) => {
        const Icon = iconFor(item.kind);
        const meta = [item.source, item.sizeBytes ? formatBytes(item.sizeBytes) : null]
          .filter(Boolean)
          .join(" · ");
        const error = failed?.id === item.id ? failed.message : null;

        if (item.kind === "image" && item.url) {
          return (
            <Card key={item.id} className={`${EVIDENCE_IMAGE_CARD} overflow-hidden`}>
              <button
                type="button"
                onClick={() => preview.open(item)}
                aria-label={`View ${item.name}`}
                className="flex w-full justify-center bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
              >
                <img src={item.url} alt={item.name} loading="lazy" className={EVIDENCE_IMAGE_FIT} />
              </button>
              {/* w-0 min-w-full: the caption wraps to the image's width instead of widening the card. */}
              <div className="w-0 min-w-full border-t border-border/70">
                <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
                  <span className="min-w-0 truncate">{item.name}</span>
                  <DownloadButton item={item} busy={busy === item.id} onDownload={start} />
                </div>
                {meta && <p className="px-3 pb-2 text-xs text-muted-foreground">{meta}</p>}
                {error && <p className="px-3 pb-2 text-xs text-danger">{error}</p>}
              </div>
            </Card>
          );
        }
        return (
          <Card key={item.id} className="flex w-full items-start gap-3 p-3 sm:w-[calc(50%-0.375rem)]">
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
      <ImagePreview item={preview.previewing} onClose={preview.close} />
    </div>
  );
}
