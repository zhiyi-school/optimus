import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type UIEvent,
} from "react";
import { ArrowDown, MessageCircle, Paperclip, RefreshCw, ShieldCheck, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/input";
import { ErrorState, LoadingState } from "@/components/common";
import { StatusBadge } from "@/components/data-display";
import { ToneBadge } from "@/components/resolve-display";
import { EvidenceViewer, type EvidenceItem } from "@/components/evidence";
import { AttachmentList } from "@/components/attachments";
import { initialsOf, roleBubbleTone, roleLabel } from "@/lib/people";
import { primaryRole } from "@/auth/permissions";
import { mapVerdictToFindingStatus } from "@/data/sync";
import type { ConversationTimelineItem } from "@/lib/conversation-timeline";
import {
  conversationEventConfig,
  conversationEventSummary,
  type ConversationEventKind,
} from "@/lib/status";
import { cn, errorMessage, formatDate, formatDuration } from "@/lib/utils";
import { CLASSIFICATION_OPTIONS } from "@/hooks/conversation-composer";
import type {
  ComposerAction,
  ComposerActionKind,
  ComposerActionOffer,
  ComposerSubmission,
} from "@/hooks/conversation-composer";
import type { AutomationResultRow } from "@/api/automation-types";
import type {
  FindingStatus,
  Profile,
  RiskConversationAttachment,
  RiskConversationEntry,
} from "@/data/types";

const ACTION_LABEL: Record<ComposerActionKind, string> = {
  classification: "Change classification",
  reassessment: "Request reassessment",
};

export interface RiskConversationPanelProps {
  title?: string;
  items: ConversationTimelineItem[] | undefined;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  /** Run history is fetched separately, so losing it must not hide the conversation. */
  historyError?: boolean;
  onRetryHistory?: () => void;
  attachmentsByEntry?: Map<string, RiskConversationAttachment[]>;
  /** Attachments are fetched separately, so losing them must not hide the messages. */
  attachmentsError?: boolean;
  onRetryAttachments?: () => void;
  evidenceUrl?: (runTimestamp: string, ref: string) => string;
  /** The run named in the URL, scrolled to and outlined on arrival. */
  highlightRunTimestamp?: string;
  currentProfileId: string | undefined;
  profileMap: Map<string, Profile>;
  canComment: boolean;
  composerNote?: string;
  onSubmit: (submission: ComposerSubmission) => Promise<unknown>;
  composerOffers?: ComposerActionOffer[];
  sending?: boolean;
  sendError?: unknown;
  attachmentRetry?: {
    fileName: string;
    retryable: boolean;
    message: string;
  } | null;
  onAbandonAttachment?: () => Promise<unknown> | unknown;
  emptyStateDescription?: string;
  /** Operational controls that act immediately, kept out of the Send flow. */
  actions?: ReactNode;
}

export function RiskConversationPanel({
  title = "Conversation",
  items,
  isLoading,
  isError,
  onRetry,
  historyError,
  onRetryHistory,
  attachmentsByEntry,
  attachmentsError,
  onRetryAttachments,
  evidenceUrl,
  highlightRunTimestamp,
  currentProfileId,
  profileMap,
  canComment,
  composerNote,
  onSubmit,
  composerOffers,
  sending,
  sendError,
  attachmentRetry,
  onAbandonAttachment,
  emptyStateDescription,
  actions,
}: RiskConversationPanelProps) {
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | undefined>();
  const [action, setAction] = useState<ComposerAction | null>(null);
  const [hasUnread, setHasUnread] = useState(false);
  const highlightedRef = useRef<HTMLLIElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const pinnedToLatest = useRef(true);
  const seenCount = useRef(0);

  const list = items ?? [];

  const scrollToLatest = useCallback(() => {
    const feed = feedRef.current;
    if (!feed) return;
    feed.scrollTop = feed.scrollHeight;
    pinnedToLatest.current = true;
    setHasUnread(false);
  }, []);

  useEffect(() => {
    if (list.length <= seenCount.current) {
      seenCount.current = list.length;
      return;
    }
    const isFirstFill = seenCount.current === 0;
    seenCount.current = list.length;
    if (isFirstFill || pinnedToLatest.current) scrollToLatest();
    else setHasUnread(true);
  }, [list.length, scrollToLatest]);

  useEffect(() => {
    if (highlightRunTimestamp) {
      highlightedRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }
  }, [highlightRunTimestamp, list.length]);

  function handleFeedScroll(event: UIEvent<HTMLDivElement>) {
    const feed = event.currentTarget;
    const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
    pinnedToLatest.current = nearBottom;
    if (nearBottom) setHasUnread(false);
  }

  const message = draft.trim();
  // Classification is an audit decision, so its reason is the message and is required.
  const ready =
    action?.kind === "classification" ? !!message : action?.kind === "reassessment" || !!message;
  const retryingAttachment = !!attachmentRetry;

  /** Adding or removing an action never touches the draft or the chosen file. */
  function selectOffer(offer: ComposerActionOffer) {
    setAction(
      offer.kind === "classification"
        ? {
            kind: "classification",
            status:
              CLASSIFICATION_OPTIONS.find((option) => option.value !== offer.currentStatus)
                ?.value ?? CLASSIFICATION_OPTIONS[0].value,
          }
        : { kind: "reassessment" },
    );
  }

  /** Enter sends through the form itself; Shift+Enter stays a newline. */
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    // An IME uses Enter to accept a candidate, which must never send.
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    if (event.repeat || sending || !ready) return;
    event.currentTarget.form?.requestSubmit();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!ready && !retryingAttachment) return;
    try {
      await onSubmit({ message, file, action: action ?? undefined });
    } catch {
      return;
    }
    setDraft("");
    setFile(undefined);
    setAction(null);
    scrollToLatest();
  }

  async function abandonAttachment() {
    await onAbandonAttachment?.();
    setDraft("");
    setFile(undefined);
    setAction(null);
  }

  return (
    <Card className="flex max-h-[calc(100vh-8rem)] min-h-[20rem] flex-col lg:h-[65vh] lg:min-h-[28rem]">
      <CardContent className="flex min-h-0 flex-1 flex-col py-5">
        <h2 className="mb-3 shrink-0 text-sm font-semibold text-foreground">{title}</h2>

        {actions && <div className="mb-4 shrink-0">{actions}</div>}

        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={feedRef}
            onScroll={handleFeedScroll}
            tabIndex={0}
            role="log"
            aria-label={title}
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-lg bg-muted/50 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {isLoading && <LoadingState label="Loading conversation…" />}

            {isError && (
              <ErrorState message="Unable to load this conversation." onRetry={onRetry} />
            )}

            {!isLoading && !isError && historyError && (
              <div className="mb-4">
                <ErrorState
                  message="Unable to load the automated test history. The conversation below is complete apart from the automated runs."
                  onRetry={onRetryHistory}
                />
              </div>
            )}

            {!isLoading && !isError && attachmentsError && (
              <div className="mb-4">
                <ErrorState
                  message="Unable to load the files attached to this conversation. The messages below are complete apart from their attachments."
                  onRetry={onRetryAttachments}
                />
              </div>
            )}

            {!isLoading && !isError && list.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
                  <MessageCircle className="h-5 w-5 text-primary" />
                </div>
                <p className="text-sm font-semibold text-foreground">Nothing here yet</p>
                {emptyStateDescription && (
                  <p className="max-w-xs text-xs text-muted-foreground">{emptyStateDescription}</p>
                )}
              </div>
            )}

            {!isLoading && !isError && list.length > 0 && (
              <ol className="space-y-4">
                {list.map((item) =>
                  item.kind === "test_run" ? (
                    <TestRunEntry
                      key={item.key}
                      run={item.run}
                      evidenceUrl={evidenceUrl}
                      highlighted={item.run.run_timestamp === highlightRunTimestamp}
                      ref={
                        item.run.run_timestamp === highlightRunTimestamp
                          ? highlightedRef
                          : undefined
                      }
                    />
                  ) : item.entry.kind === "message" ? (
                    <MessageEntry
                      key={item.key}
                      entry={item.entry}
                      attachments={attachmentsByEntry?.get(item.entry.id) ?? []}
                      author={item.entry.author_id ? profileMap.get(item.entry.author_id) : undefined}
                      isMe={!!item.entry.author_id && item.entry.author_id === currentProfileId}
                    />
                  ) : (
                    <EventEntry
                      key={item.key}
                      entry={item.entry}
                      attachments={attachmentsByEntry?.get(item.entry.id) ?? []}
                      author={item.entry.author_id ? profileMap.get(item.entry.author_id) : undefined}
                    />
                  ),
                )}
              </ol>
            )}
          </div>

          {hasUnread && (
            <button
              type="button"
              onClick={scrollToLatest}
              className="absolute inset-x-0 bottom-3 mx-auto flex w-fit items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground shadow-card hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <ArrowDown className="h-3 w-3" />
              New messages
            </button>
          )}
        </div>

        {canComment ? (
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
                  onStatus={(status) => setAction({ kind: "classification", status })}
                  onRemove={() => setAction(null)}
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
                    onChange={(event) => setFile(event.target.files?.[0])}
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
                    onClick={() => setFile(undefined)}
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
        ) : composerNote ? (
          <p className="mt-4 shrink-0 text-xs text-muted-foreground">{composerNote}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** The optional actions this reader may add to a message, and why one is unavailable. */
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
        return (
          <div key={offer.kind} className="min-w-0">
            <button
              type="button"
              disabled={disabled || !!offer.blockedReason}
              aria-describedby={noteId}
              onClick={() => onSelect(offer)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {offer.kind === "classification" ? (
                <ShieldCheck className="h-3.5 w-3.5" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
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
          <span className="text-xs text-muted-foreground">Your message is the reason.</span>
        </>
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

function MessageEntry({
  entry,
  attachments,
  author,
  isMe,
}: {
  entry: RiskConversationEntry;
  attachments: RiskConversationAttachment[];
  author: Profile | undefined;
  isMe: boolean;
}) {
  const authorRole = primaryRole(author?.roles);
  const tone = authorRole ? roleBubbleTone[authorRole] : "bg-muted";
  return (
    <li className="flex gap-3">
      <Avatar className={tone}>
        <AvatarFallback>
          {author ? initialsOf(author.display_name || author.email) : "?"}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-semibold text-foreground">
            {isMe ? "You" : (author?.display_name ?? "Team member")}
          </span>
          {authorRole && (
            <span className="text-xs text-muted-foreground">({roleLabel[authorRole]})</span>
          )}
          <span className="text-xs text-muted-foreground">{formatDate(entry.created_at)}</span>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm text-foreground">{entry.message}</p>
        <AttachmentList attachments={attachments} />
      </div>
    </li>
  );
}

function EventEntry({
  entry,
  attachments,
  author,
}: {
  entry: RiskConversationEntry;
  attachments: RiskConversationAttachment[];
  author: Profile | undefined;
}) {
  const kind = entry.kind as ConversationEventKind;
  const presentation = conversationEventConfig[kind];
  return (
    <li className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-border bg-card">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1 rounded-lg border border-dashed border-border bg-card px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <ToneBadge tone={presentation.tone} label={presentation.label} />
          <span className="text-sm text-foreground">
            {conversationEventSummary(kind, entry.metadata)}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {author?.display_name ?? "Automation"} · {formatDate(entry.created_at)}
        </p>
        {entry.message && (
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
            {entry.message}
          </p>
        )}
        <AttachmentList attachments={attachments} />
      </div>
    </li>
  );
}

const TestRunEntry = forwardRef<
  HTMLLIElement,
  {
    run: AutomationResultRow;
    evidenceUrl?: (runTimestamp: string, ref: string) => string;
    highlighted: boolean;
  }
>(function TestRunEntry({ run, evidenceUrl, highlighted }, ref) {
  return (
    <li
      ref={ref}
      className={cn(
        "flex gap-3 rounded-lg transition-colors",
        highlighted && "p-2 ring-2 ring-primary/40",
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <ShieldCheck className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-semibold text-foreground">Automated test</span>
          <span className="text-xs text-muted-foreground">{formatDate(run.started_at)}</span>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={mapVerdictToFindingStatus(run.verdict)} />
            <span className="text-xs text-muted-foreground">
              {run.status} · {formatDuration(run.duration_seconds)} · run {run.run_timestamp}
            </span>
          </div>
          <p className="break-words text-sm text-foreground">{run.summary}</p>
          {run.evidence.length > 0 && evidenceUrl && (
            <div className="mt-3">
              <EvidenceViewer
                items={run.evidence.map(
                  (item, index): EvidenceItem => ({
                    id: `${run.run_timestamp}-${index}`,
                    name: item.label,
                    kind: item.kind,
                    url: evidenceUrl(run.run_timestamp, item.ref),
                    downloadName: item.path.split("/").pop() || item.path,
                    sizeBytes: item.size_bytes,
                    source: "Automation backend",
                  }),
                )}
              />
            </div>
          )}
        </div>
      </div>
    </li>
  );
});
