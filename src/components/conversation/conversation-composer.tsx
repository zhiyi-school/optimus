/**
 * The risk conversation composer: message, file and action inputs, Enter-to-send, and the attachment retry state.
 */

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { BadgeCheck, Paperclip, RefreshCw, ShieldCheck, Undo2, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/input";
import { initialsOf } from "@/lib/people";
import { errorMessage } from "@/lib/utils";
import { createDebug } from "@/lib/debug";
import { CLASSIFICATION_OPTIONS } from "@/hooks/conversation/composer";
import type {
  ComposerAction,
  ComposerActionKind,
  ComposerActionOffer,
  ComposerSubmission,
} from "@/hooks/conversation/composer";
import type { FindingStatus, Profile } from "@/database/types";

const debug = createDebug("components:conversation:conversation-composer");

const ACTION_LABEL: Record<ComposerActionKind, string> = {
  classification: "Change classification",
  reassessment: "Request Reassessment",
  acceptance: "Accept Risk",
  retraction: "Retract Acceptance",
};

const ACTION_ICON: Record<ComposerActionKind, LucideIcon> = {
  classification: ShieldCheck,
  reassessment: RefreshCw,
  acceptance: BadgeCheck,
  retraction: Undo2,
};

// These actions are decisions on the record, so the message is their required reason.
const REASON_REQUIRED: ReadonlySet<ComposerActionKind> = new Set([
  "classification",
  "acceptance",
  "retraction",
]);

export interface ConversationComposerProps {
  currentProfileId: string | undefined;
  profileMap: Map<string, Profile>;
  onSubmit: (submission: ComposerSubmission) => Promise<unknown>;
  /** Called after a successful submit, once the composer has cleared. */
  onSubmitted: () => void;
  composerOffers?: ComposerActionOffer[];
  sending?: boolean;
  sendError?: unknown;
  attachmentRetry?: {
    fileName: string;
    retryable: boolean;
    message: string;
  } | null;
  onAbandonAttachment?: () => Promise<unknown> | unknown;
}

/** Form for a message with an optional file and action, sent on Enter; clears only when the submit succeeds. */
export function ConversationComposer({
  currentProfileId,
  profileMap,
  onSubmit,
  onSubmitted,
  composerOffers,
  sending,
  sendError,
  attachmentRetry,
  onAbandonAttachment,
}: ConversationComposerProps) {
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | undefined>();
  const [action, setAction] = useState<ComposerAction | null>(null);

  const message = draft.trim();
  const ready =
    action && REASON_REQUIRED.has(action.kind) ? !!message : action?.kind === "reassessment" || !!message;
  const retryingAttachment = !!attachmentRetry;

  /** Selects an offered action with a default status, leaving the draft and file untouched. */
  function selectOffer(offer: ComposerActionOffer) {
    debug("selects action", { kind: offer.kind });
    setAction(
      offer.kind === "classification"
        ? {
            kind: "classification",
            status:
              CLASSIFICATION_OPTIONS.find((option) => option.value !== offer.currentStatus)
                ?.value ?? CLASSIFICATION_OPTIONS[0].value,
          }
        : { kind: offer.kind },
    );
  }

  /** Submits the form on Enter while Shift+Enter inserts a newline. */
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    // An IME uses Enter to accept a candidate, which must never send.
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    if (event.repeat || sending || !ready) return;
    debug("submits on Enter", { length: message.length });
    event.currentTarget.form?.requestSubmit();
  }

  /** Submits the message, file and action, clearing the composer only on success. */
  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!ready && !retryingAttachment) {
      debug("rejects submit", { action: action?.kind ?? null, hasMessage: !!message });
      return;
    }
    debug("submits", {
      length: message.length,
      action: action?.kind ?? null,
      fileName: file?.name,
      fileSize: file?.size,
      retryingAttachment,
    });
    try {
      await onSubmit({ message, file, action: action ?? undefined });
    } catch (error) {
      debug("submit fails", { action: action?.kind ?? null, retryingAttachment }, error);
      return;
    }
    debug("submit succeeds", { action: action?.kind ?? null, retryingAttachment });
    setDraft("");
    setFile(undefined);
    setAction(null);
    onSubmitted();
  }

  /** Abandons the pending attachment retry and clears the composer. */
  async function abandonAttachment() {
    debug("abandons attachment retry", { fileName: attachmentRetry?.fileName });
    await onAbandonAttachment?.();
    debug("abandoned attachment retry");
    setDraft("");
    setFile(undefined);
    setAction(null);
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex shrink-0 items-start gap-2">
      <Avatar className="mt-0.5">
        <AvatarFallback>
          {currentProfileId
            ? initialsOf(profileMap.get(currentProfileId)?.display_name ?? "?")
            : "?"}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <ComposerOfferBar
          offers={composerOffers}
          selected={action?.kind ?? null}
          disabled={retryingAttachment}
          onSelect={selectOffer}
        />
        {action && (
          <ComposerActionChip
            action={action}
            offer={(composerOffers ?? []).find((offer) => offer.kind === action.kind)}
            disabled={retryingAttachment}
            onStatus={(status) => {
              debug("changes classification", { status });
              setAction({ kind: "classification", status });
            }}
            onRemove={() => {
              debug("removes action", { kind: action.kind });
              setAction(null);
            }}
          />
        )}
        <div className="flex items-end gap-2 rounded-lg border border-border bg-card p-2">
          <Textarea
            rows={2}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={retryingAttachment}
            placeholder="Write a message..."
            aria-label="Write a message"
            className="flex-1 resize-none border-0 p-1 shadow-none focus:ring-0"
          />
          <label className="mb-1 cursor-pointer text-muted-foreground hover:text-primary">
            <Paperclip className="h-4 w-4" />
            <span className="sr-only">Attach a file</span>
            <input
              type="file"
              className="hidden"
              disabled={retryingAttachment}
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                debug("adds attachment", {
                  fileName: chosen?.name,
                  size: chosen?.size,
                  count: event.target.files?.length ?? 0,
                });
                setFile(chosen);
              }}
            />
          </label>
          <Button
            type="submit"
            size="sm"
            disabled={sending || (retryingAttachment ? !attachmentRetry.retryable : !ready)}
          >
            {sending
              ? retryingAttachment
                ? "Attaching…"
                : "Sending…"
              : retryingAttachment
                ? "Retry file"
                : "Send"}
          </Button>
        </div>
        {file && (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Paperclip className="h-3 w-3" />
            {file.name}
            <button
              type="button"
              disabled={retryingAttachment}
              onClick={() => {
                debug("removes attachment", { fileName: file.name, size: file.size });
                setFile(undefined);
              }}
              aria-label={`Remove ${file.name}`}
              className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <X className="h-3 w-3" />
            </button>
          </p>
        )}
        {attachmentRetry && (
          <div className="mt-2 rounded-lg border border-warning/40 bg-warning/5 p-2 text-xs text-foreground">
            <p>
              The entry was recorded. {attachmentRetry.retryable
                ? `${attachmentRetry.message} Retry ${attachmentRetry.fileName} without recording it again.`
                : attachmentRetry.message}
            </p>
            <button
              type="button"
              onClick={() => void abandonAttachment()}
              className="mt-1 font-medium text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Abandon file retry
            </button>
          </div>
        )}
        {sendError && !attachmentRetry ? (
          <p className="mt-1 text-xs text-danger">
            {errorMessage(sendError, "Could not post that message.")}
          </p>
        ) : null}
      </div>
    </form>
  );
}

/** Buttons for the actions this reader may add, each showing why it is blocked. */
function ComposerOfferBar({
  offers,
  selected,
  disabled,
  onSelect,
}: {
  offers: ComposerActionOffer[] | undefined;
  selected: ComposerActionKind | null;
  disabled?: boolean;
  onSelect: (offer: ComposerActionOffer) => void;
}) {
  const available = (offers ?? []).filter((offer) => offer.kind !== selected);
  if (available.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap items-start gap-x-3 gap-y-1">
      {available.map((offer) => {
        const noteId = offer.blockedReason ? `composer-${offer.kind}-blocked` : undefined;
        const Icon = ACTION_ICON[offer.kind];
        return (
          <div key={offer.kind} className="min-w-0">
            <button
              type="button"
              disabled={disabled || !!offer.blockedReason}
              aria-describedby={noteId}
              onClick={() => onSelect(offer)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Icon className="h-3.5 w-3.5" />
              {ACTION_LABEL[offer.kind]}
            </button>
            {offer.blockedReason && (
              <p
                id={noteId}
                className="mt-1 max-w-full break-words text-xs text-muted-foreground sm:max-w-xs"
              >
                {offer.blockedReason}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Chip for the chosen composer action, with a classification picker and a remove button. */
function ComposerActionChip({
  action,
  offer,
  disabled,
  onStatus,
  onRemove,
}: {
  action: ComposerAction;
  offer: ComposerActionOffer | undefined;
  disabled?: boolean;
  onStatus: (status: FindingStatus) => void;
  onRemove: () => void;
}) {
  const currentStatus = offer?.kind === "classification" ? offer.currentStatus : undefined;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-2 py-1.5">
      <span className="text-xs font-medium text-foreground">{ACTION_LABEL[action.kind]}</span>
      {action.kind === "classification" && (
        <>
          <label htmlFor="composer-classification" className="sr-only">
            New classification
          </label>
          <select
            id="composer-classification"
            value={action.status}
            disabled={disabled}
            onChange={(event) => onStatus(event.target.value as FindingStatus)}
            className="h-7 rounded-md border border-border bg-card px-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {CLASSIFICATION_OPTIONS.filter((option) => option.value !== currentStatus).map(
              (option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ),
            )}
          </select>
        </>
      )}
      {REASON_REQUIRED.has(action.kind) && (
        <span className="text-xs text-muted-foreground">Your message is the reason.</span>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={onRemove}
        aria-label={`Remove ${ACTION_LABEL[action.kind].toLowerCase()}`}
        className="ml-auto rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
