/**
 * Hook for downloading risk conversation attachments through on-demand signed URLs.
 */

import { useState } from "react";
import { conversationAttachmentData } from "@/database/conversation-attachments";
import { attachmentSource } from "@/domain/conversation/attachments";
import { createDebug } from "@/lib/debug";
import { downloadFile } from "@/lib/download";
import { UserFacingError, errorMessage } from "@/lib/utils";
import type { RiskConversationAttachment } from "@/database/types";

const debug = createDebug("hooks:attachment-download");

/** Mints an uncached signed URL per download so links cannot outlive access; server-held files are unsupported. */
async function attachmentUrl(attachment: RiskConversationAttachment): Promise<string> {
  const source = attachmentSource(attachment);
  debug("resolves attachment source", { attachmentId: attachment.id, provider: source.provider });
  if (source.provider === "server") {
    throw new UserFacingError(
      "This file is held by the automation server, which cannot serve it to the dashboard yet.",
    );
  }
  const { data, error } = await conversationAttachmentData.getSignedUrl(source.path);
  if (error || !data?.signedUrl) {
    debug("signed url unavailable", { attachmentId: attachment.id, error });
    throw new UserFacingError(
      "This file could not be opened. It may have been removed from storage.",
    );
  }
  return data.signedUrl;
}

/** Tracks busy and failed attachment downloads and exposes a start function. */
export function useAttachmentDownload() {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);

  /** Downloads an attachment unless another download is in progress, recording any failure. */
  async function start(attachment: RiskConversationAttachment) {
    if (busy) {
      debug("ignores download while busy", { attachmentId: attachment.id, busy });
      return;
    }
    debug("downloads attachment", { attachmentId: attachment.id, fileName: attachment.file_name });
    setBusy(attachment.id);
    setFailed(null);
    try {
      await downloadFile(await attachmentUrl(attachment), attachment.file_name);
      debug("downloaded attachment", { attachmentId: attachment.id });
    } catch (error) {
      debug("attachment download failed", { attachmentId: attachment.id, error });
      setFailed({
        id: attachment.id,
        message: errorMessage(error, "That file could not be downloaded."),
      });
    } finally {
      setBusy(null);
    }
  }

  return { busy, failed, start };
}
