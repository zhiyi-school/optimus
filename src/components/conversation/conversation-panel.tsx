/**
 * Risk conversation panel: the feed of messages, events and automated runs above the message composer.
 */

import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { ConversationTimelineItem } from "@/domain/conversation/timeline";
import type { ComposerActionOffer, ComposerSubmission } from "@/hooks/conversation/composer";
import type { Profile, RiskConversationAttachment } from "@/database/types";
import { ConversationComposer } from "./conversation-composer";
import { ConversationFeed } from "./conversation-feed";
import { useFeedScroll } from "./feed-scroll";

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

/** Scrollable conversation feed with unread tracking and a composer for messages, files and actions. */
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
  const list = items ?? [];
  const scroll = useFeedScroll(list.length, highlightRunTimestamp);

  return (
    <Card className="flex max-h-[calc(100vh-8rem)] min-h-[20rem] flex-col lg:h-[65vh] lg:min-h-[28rem]">
      <CardContent className="flex min-h-0 flex-1 flex-col py-5">
        <h2 className="mb-3 shrink-0 text-sm font-semibold text-foreground">{title}</h2>

        {actions && <div className="mb-4 shrink-0">{actions}</div>}

        <ConversationFeed
          title={title}
          items={list}
          scroll={scroll}
          isLoading={isLoading}
          isError={isError}
          onRetry={onRetry}
          historyError={historyError}
          onRetryHistory={onRetryHistory}
          attachmentsByEntry={attachmentsByEntry}
          attachmentsError={attachmentsError}
          onRetryAttachments={onRetryAttachments}
          evidenceUrl={evidenceUrl}
          highlightRunTimestamp={highlightRunTimestamp}
          currentProfileId={currentProfileId}
          profileMap={profileMap}
          emptyStateDescription={emptyStateDescription}
        />

        {canComment ? (
          <ConversationComposer
            currentProfileId={currentProfileId}
            profileMap={profileMap}
            onSubmit={onSubmit}
            onSubmitted={scroll.scrollToLatest}
            composerOffers={composerOffers}
            sending={sending}
            sendError={sendError}
            attachmentRetry={attachmentRetry}
            onAbandonAttachment={onAbandonAttachment}
          />
        ) : composerNote ? (
          <p className="mt-4 shrink-0 text-xs text-muted-foreground">{composerNote}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
