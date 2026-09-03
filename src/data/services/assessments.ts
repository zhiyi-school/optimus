import { supabase, ATTACHMENTS_BUCKET } from "@/data/supabase";
import type {
  Application,
  Assessment,
  AssessmentRunRequest,
  RiskConversation,
  RiskConversationAttachment,
  RiskConversationEntry,
  RiskConversationEntryKind,
} from "@/data/types";
import { requireUserId } from "./common";

export const assessmentData = {
  async list(): Promise<Assessment[]> {
    const { data, error } = await supabase
      .from("assessments")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data;
  },

  async get(id: string): Promise<Assessment | null> {
    const { data, error } = await supabase
      .from("assessments")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async upsertByExternalId(
    assessment: Partial<Assessment> & { external_id: string },
  ): Promise<Assessment> {
    const { data, error } = await supabase
      .from("assessments")
      .upsert(assessment, { onConflict: "external_id" })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async findByExternalId(externalId: string): Promise<Assessment | null> {
    const { data, error } = await supabase
      .from("assessments")
      .select("*")
      .eq("external_id", externalId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /** The placeholder row created from the dashboard, before any run has been linked to it. */
  async findPlaceholderForApplication(applicationId: string): Promise<Assessment | null> {
    const { data, error } = await supabase
      .from("assessments")
      .select("*")
      .eq("application_id", applicationId)
      .like("external_id", "manual::%")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async update(assessmentId: string, patch: Partial<Assessment>): Promise<Assessment> {
    const { data, error } = await supabase
      .from("assessments")
      .update(patch)
      .eq("id", assessmentId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async claimPlaceholderForRun(
    assessmentId: string,
    patch: Partial<Assessment> & { external_id: string },
  ): Promise<Assessment | null> {
    const { data, error } = await supabase
      .from("assessments")
      .update(patch)
      .eq("id", assessmentId)
      .like("external_id", "manual::%")
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async findForApplication(applicationId: string): Promise<Assessment | null> {
    const { data, error } = await supabase
      .from("assessments")
      .select("*")
      .eq("application_id", applicationId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async create(
    assessment: Partial<Assessment> & { external_id: string; application_id: string },
  ): Promise<Assessment> {
    const { data, error } = await supabase.from("assessments").insert(assessment).select().single();
    if (error) throw error;
    return data;
  },

  async listWithApplications(): Promise<
    (Assessment & { application: Application | null })[]
  > {
    const { data, error } = await supabase
      .from("assessments")
      .select("*, application:applications(*)")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data as (Assessment & { application: Application | null })[];
  },

  async getWithApplication(
    id: string,
  ): Promise<(Assessment & { application: Application | null }) | null> {
    const { data, error } = await supabase
      .from("assessments")
      .select("*, application:applications(*)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data as (Assessment & { application: Application | null }) | null;
  },
};

export interface RiskConversationEntryInput {
  conversation_id: string;
  kind: RiskConversationEntryKind;
  message?: string | null;
  metadata?: Record<string, unknown>;
  source_ticket_id?: string | null;
  /** Names the workflow step an event records, so a retry cannot post it twice. */
  sync_key?: string | null;
}

export const assessmentRunRequestData = {
  /** The one active request, or the most recent if none is active. */
  async findForAssessment(assessmentId: string): Promise<AssessmentRunRequest | null> {
    const { data, error } = await supabase
      .from("assessment_run_requests")
      .select("*")
      .eq("assessment_id", assessmentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /**
   * Idempotent by design: the database returns the request already in flight
   * rather than opening a second one, so a double click cannot queue two runs.
   */
  async request(assessmentId: string): Promise<AssessmentRunRequest> {
    const { data, error } = await supabase.rpc("request_assessment_run", {
      p_assessment_id: assessmentId,
    });
    if (error) throw error;
    return data as AssessmentRunRequest;
  },
};

export interface RiskConversationOwner {
  applicationId: string;
  riskId: string;
  findingId?: string | null;
  /** The assessment the reader arrived from, kept so a risk page can be reached again. */
  originAssessmentId?: string | null;
}

export const riskConversationData = {
  async find(applicationId: string, riskId: string): Promise<RiskConversation | null> {
    const { data, error } = await supabase
      .from("risk_conversations")
      .select("*")
      .eq("application_id", applicationId)
      .eq("risk_id", riskId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async get(id: string): Promise<RiskConversation | null> {
    const { data, error } = await supabase
      .from("risk_conversations")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /**
   * One conversation per application risk, however many assessments the
   * application has had. The unique key on (application, risk) is what makes a
   * simultaneous open from two tabs safe: the loser of the upsert reads back
   * the row the winner created.
   */
  async getOrCreate(owner: RiskConversationOwner): Promise<RiskConversation> {
    const existing = await riskConversationData.find(owner.applicationId, owner.riskId);
    if (existing) {
      const patch: Partial<RiskConversation> = {};
      if (owner.findingId && existing.finding_id !== owner.findingId) {
        patch.finding_id = owner.findingId;
      }
      if (owner.originAssessmentId && !existing.origin_assessment_id) {
        patch.origin_assessment_id = owner.originAssessmentId;
      }
      if (Object.keys(patch).length === 0) return existing;
      const { data, error } = await supabase
        .from("risk_conversations")
        .update(patch)
        .eq("id", existing.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    }
    const { data, error } = await supabase
      .from("risk_conversations")
      .upsert(
        {
          application_id: owner.applicationId,
          risk_id: owner.riskId,
          origin_assessment_id: owner.originAssessmentId ?? null,
          finding_id: owner.findingId ?? null,
        },
        { onConflict: "application_id,risk_id" },
      )
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async listEntries(conversationId: string): Promise<RiskConversationEntry[]> {
    const { data, error } = await supabase
      .from("risk_conversation_entries")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .order("seq", { ascending: true });
    if (error) throw error;
    return data;
  },

  async listAttachments(entryIds: string[]): Promise<RiskConversationAttachment[]> {
    if (entryIds.length === 0) return [];
    const { data, error } = await supabase
      .from("risk_conversation_attachments")
      .select("*")
      .in("entry_id", entryIds)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data;
  },

  async addEntry(input: RiskConversationEntryInput): Promise<RiskConversationEntry> {
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from("risk_conversation_entries")
      .insert({
        conversation_id: input.conversation_id,
        kind: input.kind,
        author_id: userId,
        message: input.message ?? null,
        metadata: input.metadata ?? {},
        source_ticket_id: input.source_ticket_id ?? null,
        sync_key: input.sync_key ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async findEntryBySyncKey(syncKey: string): Promise<RiskConversationEntry | null> {
    const { data, error } = await supabase
      .from("risk_conversation_entries")
      .select("*")
      .eq("sync_key", syncKey)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /**
   * Posts a workflow event at most once. The unique index on sync_key is the
   * real guarantee; the look-ups on either side of the insert turn a losing
   * race into the entry the winner wrote rather than an error.
   */
  async addEntryOnce(
    input: RiskConversationEntryInput & { sync_key: string },
  ): Promise<RiskConversationEntry> {
    const existing = await riskConversationData.findEntryBySyncKey(input.sync_key);
    if (existing) return existing;
    try {
      return await riskConversationData.addEntry(input);
    } catch (error) {
      const written = await riskConversationData.findEntryBySyncKey(input.sync_key);
      if (written) return written;
      throw error;
    }
  },

  async uploadAttachment(
    conversationId: string,
    entryId: string,
    file: File,
  ): Promise<RiskConversationAttachment> {
    const userId = await requireUserId();
    const storagePath = `conversation-${conversationId}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(storagePath, file);
    if (uploadError) throw uploadError;

    const { data, error } = await supabase
      .from("risk_conversation_attachments")
      .insert({
        entry_id: entryId,
        uploaded_by: userId,
        storage_path: storagePath,
        file_name: file.name,
        mime_type: file.type || null,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  getSignedUrl(storagePath: string) {
    return supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(storagePath, 3600);
  },

  subscribeToConversation(conversationId: string, onChange: () => void) {
    const channel = supabase
      .channel(`risk-conversation-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "risk_conversation_entries",
          filter: `conversation_id=eq.${conversationId}`,
        },
        onChange,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  },
};
