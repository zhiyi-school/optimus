import { useState } from "react";
import { riskConversationData } from "@/data/services/conversations";
import { attachmentSource } from "@/lib/attachments";
import { downloadFile } from "@/lib/download";
import { UserFacingError, errorMessage } from "@/lib/utils";
import type { RiskConversationAttachment } from "@/data/types";

/** Minted per download and never cached, so a link cannot outlive the reader's access. */
async function attachmentUrl(attachment: RiskConversationAttachment): Promise<string> {
  const source = attachmentSource(attachment);
  if (source.provider === "server") {
    throw new UserFacingError(
      "This file is held by the automation server, which cannot serve it to the dashboard yet.",
    );
  }
  const { data, error } = await riskConversationData.getSignedUrl(source.path);
  if (error || !data?.signedUrl) {
    throw new UserFacingError(
      "This file could not be opened. It may have been removed from storage.",
    );
  }
  return data.signedUrl;
}

export function useAttachmentDownload() {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);

  async function start(attachment: RiskConversationAttachment) {
    if (busy) return;
    setBusy(attachment.id);
    setFailed(null);
    try {
      await downloadFile(await attachmentUrl(attachment), attachment.file_name);
    } catch (error) {
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
