import { useState, type FormEvent } from "react";
import { CheckCircle2, MessageCircle, Paperclip } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/input";
import { LoadingState } from "@/components/common";
import { initialsOf, roleBubbleTone, roleLabel } from "@/lib/people";
import { primaryRole } from "@/auth/permissions";
import { formatDate } from "@/lib/utils";
import type { Profile } from "@/data/types";

interface ConversationMessage {
  id: string;
  author_id: string;
  message: string;
  created_at: string;
}

interface ConversationAttachment {
  id: string;
  message_id: string | null;
  file_name: string;
}

export interface ConversationPanelProps {
  title?: string;
  messages: ConversationMessage[] | undefined;
  isLoading?: boolean;
  currentProfileId: string | undefined;
  profileMap: Map<string, Profile>;
  canComment: boolean;
  onSend: (message: string) => Promise<unknown>;
  sending?: boolean;
  emptyStateDescription?: string;
  /** Pre-fills the composer with a helpful starting template (e.g. a manual-test report scaffold). */
  draftTemplate?: string;
  /** Ticket-only — omit entirely for conversations that don't support attachments. */
  attachments?: ConversationAttachment[];
  attachmentsByMessage?: Map<string, ConversationAttachment[]>;
  onUploadAttachment?: (file: File) => Promise<unknown>;
}

export function ConversationPanel({
  title = "Conversation",
  messages,
  isLoading,
  currentProfileId,
  profileMap,
  canComment,
  onSend,
  sending,
  emptyStateDescription,
  draftTemplate,
  attachments,
  attachmentsByMessage,
  onUploadAttachment,
}: ConversationPanelProps) {
  const [draft, setDraft] = useState(draftTemplate ?? "");

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    await onSend(draft.trim());
    setDraft(draftTemplate ?? "");
  }

  const unlinkedAttachments = (attachments ?? []).filter((a) => !a.message_id);
  const list = messages ?? [];

  return (
    <Card>
      <CardContent className="py-5">
        <h2 className="mb-3 text-sm font-semibold text-foreground">{title}</h2>

        <div className="rounded-lg bg-muted/50 p-4">
          {isLoading && <LoadingState label="Loading conversation…" />}

          {!isLoading && list.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
                <MessageCircle className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm font-semibold text-foreground">No messages yet</p>
              {emptyStateDescription && (
                <p className="max-w-xs text-xs text-muted-foreground">{emptyStateDescription}</p>
              )}
            </div>
          )}

          {!isLoading && list.length > 0 && (
            <ul className="space-y-4">
              {list.map((m, i) => {
                const author = profileMap.get(m.author_id);
                const isMe = m.author_id === currentProfileId;
                const authorRole = primaryRole(author?.roles);
                const tone = authorRole ? roleBubbleTone[authorRole] : "bg-muted";
                const linkedAttachments = attachmentsByMessage?.get(m.id) ?? [];
                const isLast = i === list.length - 1;
                return (
                  <li key={m.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <Avatar className={tone}>
                        <AvatarFallback>
                          {author ? initialsOf(author.display_name || author.email) : "?"}
                        </AvatarFallback>
                      </Avatar>
                      {!isLast && (
                        <div className="mt-1 flex flex-1 flex-col items-center">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <div className="w-px flex-1 bg-border" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 pb-1">
                      <div className="mb-1 flex flex-wrap items-baseline gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {isMe ? "You" : (author?.display_name ?? "Team member")}
                        </span>
                        {authorRole && (
                          <span className="text-xs text-muted-foreground">
                            ({roleLabel[authorRole]})
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">{formatDate(m.created_at)}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-foreground">{m.message}</p>
                      {linkedAttachments.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {linkedAttachments.map((a) => (
                            <div key={a.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Paperclip className="h-3 w-3" />
                              {a.file_name}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {canComment && (
          <form onSubmit={handleSend} className="mt-4 flex items-start gap-2">
            <Avatar className="mt-0.5">
              <AvatarFallback>
                {currentProfileId ? initialsOf(profileMap.get(currentProfileId)?.display_name ?? "?") : "?"}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-1 items-end gap-2 rounded-lg border border-border bg-card p-2">
              <Textarea
                rows={draftTemplate ? 4 : 2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Write a message…"
                className="flex-1 resize-none border-0 p-1 shadow-none focus:ring-0"
              />
              {onUploadAttachment && (
                <label className="mb-1 cursor-pointer text-muted-foreground hover:text-primary">
                  <Paperclip className="h-4 w-4" />
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void onUploadAttachment(file);
                    }}
                  />
                </label>
              )}
              <Button type="submit" size="sm" disabled={sending || !draft.trim()}>
                Send
              </Button>
            </div>
          </form>
        )}

        {unlinkedAttachments.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Attachments
            </p>
            <ul className="space-y-1 text-sm">
              {unlinkedAttachments.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-foreground">
                  <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                  {a.file_name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
