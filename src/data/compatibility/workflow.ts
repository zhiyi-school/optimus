import { supabase } from "@/data/supabase";
import type {
  Finding,
  FindingStatus,
  RiskConversationAttachment,
} from "@/data/types";

export type ClassificationCapability = "entry" | "legacy_without_entry";

export interface ClassificationResult {
  finding: Finding;
  entryId: string | null;
  capability: ClassificationCapability;
}

interface ClassificationInput {
  findingId: string;
  conversationId: string;
  status: FindingStatus;
  reason: string;
}

export async function classifyRiskWithCompatibility(
  input: ClassificationInput,
): Promise<ClassificationResult> {
  const params = {
    p_finding_id: input.findingId,
    p_conversation_id: input.conversationId,
    p_status: input.status,
    p_reason: input.reason,
  };
  const current = await supabase.rpc("classify_risk_entry", params);
  if (!current.error) {
    const payload = current.data as { finding: Finding; entry_id: string };
    return { finding: payload.finding, entryId: payload.entry_id, capability: "entry" };
  }
  if (!isMissingFunction(current.error)) throw current.error;

  const legacy = await supabase.rpc("classify_risk", params);
  if (legacy.error) throw legacy.error;
  return {
    finding: legacy.data as Finding,
    entryId: null,
    capability: "legacy_without_entry",
  };
}

export interface AttachmentMetadataRow {
  entry_id: string;
  uploaded_by: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  storage_provider: "supabase";
  size_bytes: number;
}

export type AttachmentMetadataCapability = "provider_metadata" | "legacy_supabase";

export interface AttachmentInsertResult {
  attachment: RiskConversationAttachment;
  capability: AttachmentMetadataCapability;
}

export async function insertAttachmentWithCompatibility(
  row: AttachmentMetadataRow,
): Promise<AttachmentInsertResult> {
  const current = await supabase
    .from("risk_conversation_attachments")
    .insert(row)
    .select()
    .single();
  if (!current.error) return { attachment: current.data, capability: "provider_metadata" };
  if (!isMissingAttachmentMetadataColumn(current.error)) throw current.error;

  const legacyRow = {
    entry_id: row.entry_id,
    uploaded_by: row.uploaded_by,
    storage_path: row.storage_path,
    file_name: row.file_name,
    mime_type: row.mime_type,
  };
  const legacy = await supabase
    .from("risk_conversation_attachments")
    .insert(legacyRow)
    .select()
    .single();
  if (legacy.error) throw legacy.error;
  return { attachment: legacy.data, capability: "legacy_supabase" };
}

function isMissingFunction(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  const message = String((error as { message?: unknown })?.message ?? "");
  return code === "PGRST202" || /could not find the function/i.test(message);
}

function isMissingAttachmentMetadataColumn(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  const message = String((error as { message?: unknown })?.message ?? "");
  return (
    (code === "PGRST204" || code === "42703") &&
    /(storage_provider|size_bytes)/i.test(message)
  );
}
