/**
 * Supabase operations on risk conversations, their entries and realtime updates.
 */

import { supabase } from "@/database/client";
import type {
  RiskConversation,
  RiskConversationEntry,
  RiskConversationEntryKind,
} from "@/database/types";
import { createDebug } from "@/lib/debug";
import { requireUserId } from "./session";

const debug = createDebug("database:conversations");

export interface RiskConversationEntryInput {
  conversation_id: string;
  kind: RiskConversationEntryKind;
  message?: string | null;
  metadata?: Record<string, unknown>;
  source_ticket_id?: string | null;
  /** Names the workflow step an event records, so a retry cannot post it twice. */
  sync_key?: string | null;
}

export interface RiskConversationOwner {
  applicationId: string;
  riskId: string;
  findingId?: string | null;
  /** The assessment the reader arrived from, kept so a risk page can be reached again. */
  originAssessmentId?: string | null;
}

export const riskConversationData = {
  /** Finds the conversation for an application risk, or null. */
  async find(applicationId: string, riskId: string): Promise<RiskConversation | null> {
    debug("finding conversation", { applicationId, riskId });
    const { data, error } = await supabase
      .from("risk_conversations")
      .select("*")
      .eq("application_id", applicationId)
      .eq("risk_id", riskId)
      .maybeSingle();
    if (error) {
      debug("finding conversation failed", {
        applicationId,
        riskId,
        code: error.code,
        message: error.message,
      });
      throw error;
    }
    debug("conversation lookup", { applicationId, riskId, id: data?.id ?? null });
    return data;
  },

  /** Returns the app risk's conversation, creating it or filling in missing links; the unique key settles races. */
  async getOrCreate(owner: RiskConversationOwner): Promise<RiskConversation> {
    debug("getting or creating conversation", owner);
    const existing = await riskConversationData.find(owner.applicationId, owner.riskId);
    if (existing) {
      const patch: Partial<RiskConversation> = {};
      if (owner.findingId && existing.finding_id !== owner.findingId) {
        patch.finding_id = owner.findingId;
      }
      if (owner.originAssessmentId && !existing.origin_assessment_id) {
        patch.origin_assessment_id = owner.originAssessmentId;
      }
      if (Object.keys(patch).length === 0) {
        debug("conversation exists and is current", { id: existing.id });
        return existing;
      }
      debug("patching existing conversation", { id: existing.id, fields: Object.keys(patch) });
      const { data, error } = await supabase.from("risk_conversations").update(patch).eq("id", existing.id).select().single();
      if (error) {
        debug("patching conversation failed", {
          id: existing.id,
          code: error.code,
          message: error.message,
        });
        throw error;
      }
      debug("patched conversation", { id: data?.id });
      return data;
    }
    debug("no conversation yet; upserting", {
      applicationId: owner.applicationId,
      riskId: owner.riskId,
    });
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
    if (error) {
      debug("upserting conversation failed", {
        applicationId: owner.applicationId,
        riskId: owner.riskId,
        code: error.code,
        message: error.message,
      });
      throw error;
    }
    debug("upserted conversation", { id: data?.id });
    return data;
  },

  /** Lists a conversation's entries in creation order. */
  async listEntries(conversationId: string): Promise<RiskConversationEntry[]> {
    debug("listing conversation entries", { conversationId });
    const { data, error } = await supabase
      .from("risk_conversation_entries")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .order("seq", { ascending: true });
    if (error) {
      debug("listing conversation entries failed", {
        conversationId,
        code: error.code,
        message: error.message,
      });
      throw error;
    }
    debug("listed conversation entries", { conversationId, count: data?.length });
    return data;
  },

  /** Inserts a conversation entry authored by the signed-in user. */
  async addEntry(input: RiskConversationEntryInput): Promise<RiskConversationEntry> {
    debug("adding conversation entry", {
      conversationId: input.conversation_id,
      kind: input.kind,
      messageLength: input.message?.length ?? 0,
      metadataKeys: input.metadata ? Object.keys(input.metadata) : [],
      sourceTicketId: input.source_ticket_id ?? null,
      syncKey: input.sync_key ?? null,
    });
    const userId = await requireUserId();
    const { data, error } = await supabase.from("risk_conversation_entries").insert({
      conversation_id: input.conversation_id,
      kind: input.kind,
      author_id: userId,
      message: input.message ?? null,
      metadata: input.metadata ?? {},
      source_ticket_id: input.source_ticket_id ?? null,
      sync_key: input.sync_key ?? null,
    }).select().single();
    if (error) {
      debug("adding conversation entry failed", {
        conversationId: input.conversation_id,
        kind: input.kind,
        code: error.code,
        message: error.message,
      });
      throw error;
    }
    debug("added conversation entry", { entryId: data?.id, kind: input.kind });
    return data;
  },

  /** Finds the entry recorded under a sync key, or null. */
  async findEntryBySyncKey(syncKey: string): Promise<RiskConversationEntry | null> {
    debug("finding entry by sync key", { syncKey });
    const { data, error } = await supabase.from("risk_conversation_entries").select("*").eq("sync_key", syncKey).maybeSingle();
    if (error) {
      debug("finding entry by sync key failed", { syncKey, code: error.code, message: error.message });
      throw error;
    }
    debug("entry by sync key lookup", { syncKey, entryId: data?.id ?? null });
    return data;
  },

  /** Adds an entry once per sync key, returning the existing row on a retry or a lost insert race. */
  async addEntryOnce(
    input: RiskConversationEntryInput & { sync_key: string },
  ): Promise<RiskConversationEntry> {
    const existing = await riskConversationData.findEntryBySyncKey(input.sync_key);
    if (existing) {
      debug("entry already recorded for sync key; reusing", { syncKey: input.sync_key });
      return existing;
    }
    try {
      return await riskConversationData.addEntry(input);
    } catch (error) {
      debug("adding entry once failed; checking for concurrent write", {
        syncKey: input.sync_key,
        code: (error as { code?: string } | null)?.code,
        message: (error as Error | null)?.message,
      });
      const written = await riskConversationData.findEntryBySyncKey(input.sync_key);
      if (written) {
        debug("entry written concurrently; reusing", { syncKey: input.sync_key, entryId: written.id });
        return written;
      }
      throw error;
    }
  },

  /** Calls `onChange` on each new entry in the conversation; returns the unsubscribe function. */
  subscribeToConversation(conversationId: string, onChange: () => void) {
    debug("subscribing to conversation", { conversationId });
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
      debug("unsubscribing from conversation", { conversationId });
      supabase.removeChannel(channel);
    };
  },
};
