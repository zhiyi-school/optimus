/**
 * The scrollable risk conversation feed with its load, partial-failure and empty states.
 */

import { ArrowDown, MessageCircle } from "lucide-react";
import { ErrorState, LoadingState } from "@/components/layout/page-blocks";
import { createDebug } from "@/lib/debug";
import type { ConversationTimelineItem } from "@/domain/conversation/timeline";
import type { Profile, RiskConversationAttachment } from "@/database/types";
import { EventEntry, MessageEntry, TestRunEntry } from "./conversation-entries";
import type { FeedScroll } from "./feed-scroll";

const debug = createDebug("components:conversation:conversation-feed");

export interface ConversationFeedProps {
  title: string;
  items: ConversationTimelineItem[];
  scroll: FeedScroll;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  historyError?: boolean;
  onRetryHistory?: () => void;
  attachmentsByEntry?: Map<string, RiskConversationAttachment[]>;
  attachmentsError?: boolean;
  onRetryAttachments?: () => void;
  evidenceUrl?: (runTimestamp: string, ref: string) => string;
  highlightRunTimestamp?: string;
  currentProfileId: string | undefined;
  profileMap: Map<string, Profile>;
  emptyStateDescription?: string;
}

/** Renders the feed with its load, partial-failure and empty states and a jump-to-latest button. */
export function ConversationFeed({
  title,
  items,
  scroll,
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
  emptyStateDescription,
}: ConversationFeedProps) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroll.feedRef}
        onScroll={scroll.onScroll}
        tabIndex={0}
        role="log"
        aria-label={title}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-lg bg-muted/50 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        {isLoading && <LoadingState label="Loading conversation…" />}

        {isError && (
          <ErrorState
            message="Unable to load this conversation."
            onRetry={
              onRetry &&
              (() => {
                debug("retries conversation");
                onRetry();
              })
            }
          />
        )}

        {!isLoading && !isError && historyError && (
          <div className="mb-4">
            <ErrorState
              message="Unable to load the automated test history. The conversation below is complete apart from the automated runs."
              onRetry={
                onRetryHistory &&
                (() => {
                  debug("retries run history");
                  onRetryHistory();
                })
              }
            />
          </div>
        )}

        {!isLoading && !isError && attachmentsError && (
          <div className="mb-4">
            <ErrorState
              message="Unable to load the files attached to this conversation. The messages below are complete apart from their attachments."
              onRetry={
                onRetryAttachments &&
                (() => {
                  debug("retries attachments");
                  onRetryAttachments();
                })
              }
            />
          </div>
        )}

        {!isLoading && !isError && items.length === 0 && (
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

        {!isLoading && !isError && items.length > 0 && (
          <ol className="space-y-4">
            {items.map((item) =>
              item.kind === "test_run" ? (
                <TestRunEntry
                  key={item.key}
                  run={item.run}
                  evidenceUrl={evidenceUrl}
                  highlighted={item.run.run_timestamp === highlightRunTimestamp}
                  ref={
                    item.run.run_timestamp === highlightRunTimestamp
                      ? scroll.highlightedRef
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

      {scroll.hasUnread && (
        <button
          type="button"
          onClick={() => {
            debug("jumps to latest");
            scroll.scrollToLatest();
          }}
          className="absolute inset-x-0 bottom-3 mx-auto flex w-fit items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground shadow-card hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <ArrowDown className="h-3 w-3" />
          New messages
        </button>
      )}
    </div>
  );
}
