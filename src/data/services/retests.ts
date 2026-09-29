/**
 * Supabase operations on reassessment (retest) requests: the queue, claiming, withdrawal and run linking.
 */

import { supabase } from "@/data/supabase";
import type { RetestRun } from "@/data/types";
import { activityData } from "./activity";
import { riskConversationData } from "./conversations";
import { createDebug } from "@/lib/debug";

const debug = createDebug("data:retests");

export const retestData = {
  /** Lists a finding's retest runs, newest first. */
  async listForFinding(findingId: string): Promise<RetestRun[]> {
    debug("listing retest runs", { findingId });
    const { data, error } = await supabase
      .from("retest_runs")
      .select("*")
      .eq("finding_id", findingId)
      .order("created_at", { ascending: false });
    if (error) {
      debug("listing retest runs failed", { findingId, code: error.code, message: error.message });
      throw error;
    }
    debug("listed retest runs", { findingId, count: data?.length });
    return data;
  },

  /** Queues a reassessment once per submission; a retry of the same submission returns the request it made. */
  async requestRetest(input: {
    conversationId: string;
    findingId: string;
    ticketId?: string | null;
    /** Optional context, carried on the request event rather than posted twice. */
    message?: string | null;
    /** One intentional Send. A retry of it resolves to the request it already made. */
    submissionId: string;
  }): Promise<{ run: RetestRun; entryId: string }> {
    debug("rpc request_reassessment_entry", {
      conversationId: input.conversationId,
      findingId: input.findingId,
      ticketId: input.ticketId ?? null,
      submissionId: input.submissionId,
      messageLength: input.message?.trim().length ?? 0,
    });
    const { data, error } = await supabase.rpc("request_reassessment_entry", {
      p_conversation_id: input.conversationId,
      p_finding_id: input.findingId,
      p_ticket_id: input.ticketId ?? null,
      p_message: input.message?.trim() || null,
      p_submission_id: input.submissionId,
    });
    if (error) {
      debug("rpc request_reassessment_entry failed", { code: error.code, message: error.message });
      throw error;
    }
    const payload = data as { run: RetestRun; entry_id: string };
    debug("reassessment queued", { runId: payload.run?.id, entryId: payload.entry_id });
    return { run: payload.run, entryId: payload.entry_id };
  },

  /** Claims a queued reassessment before automation starts, so a just-withdrawn request never runs. */
  async startRun(id: string): Promise<RetestRun> {
    debug("rpc start_reassessment", { retestId: id });
    const { data, error } = await supabase.rpc("start_reassessment", { p_retest_id: id });
    if (error) {
      debug("rpc start_reassessment failed", { retestId: id, code: error.code, message: error.message });
      throw error;
    }
    debug("rpc start_reassessment returned", {
      retestId: id,
      status: (data as RetestRun | null)?.status,
    });
    return data as RetestRun;
  },

  /** Withdraws a queued reassessment with a required reason, restoring the ticket's prior status. */
  async withdraw(retestId: string, reason: string): Promise<RetestRun> {
    const trimmed = reason.trim();
    debug("withdrawing reassessment", { retestId, reasonLength: trimmed.length });
    if (!trimmed) {
      debug("refusing reassessment withdrawal without reason", { retestId });
      throw new Error("Withdrawing a reassessment needs a reason.");
    }
    const { data, error } = await supabase.rpc("withdraw_reassessment", {
      p_retest_id: retestId,
      p_reason: trimmed,
    });
    if (error) {
      debug("rpc withdraw_reassessment failed", { retestId, code: error.code, message: error.message });
      throw error;
    }
    const run = data as RetestRun;
    debug("withdrew reassessment", {
      retestId,
      ticketId: run?.ticket_id,
      restoredStatus: run?.previous_ticket_status,
    });
    await activityData.log({
      entity_type: "retest_run",
      entity_id: run.id,
      action: "reassessment_withdrawn",
      metadata: { ticket_id: run.ticket_id, restored_status: run.previous_ticket_status },
    });
    return run;
  },

  /** Links a retest to its automation run and records the start in the conversation once. */
  async markRunning(id: string, externalTestRunId: string): Promise<RetestRun> {
    debug("marking retest running", { retestId: id, externalTestRunId });
    const { data, error } = await supabase
      .from("retest_runs")
      .update({ external_test_run_id: externalTestRunId })
      .eq("id", id)
      .select()
      .single();
    if (error) {
      debug("marking retest running failed", { retestId: id, code: error.code, message: error.message });
      throw error;
    }
    debug("marked retest running", { retestId: id, conversationId: data?.conversation_id ?? null });
    if (data.conversation_id) {
      await riskConversationData.addEntryOnce({
        conversation_id: data.conversation_id,
        kind: "retest_started",
        metadata: { run_timestamp: externalTestRunId },
        source_ticket_id: data.ticket_id,
        sync_key: `retest-started::${id}::${externalTestRunId}`,
      });
    }
    return data;
  },
};
