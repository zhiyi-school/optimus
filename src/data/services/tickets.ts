import { supabase } from "@/data/supabase";
import type { Application, Finding, RetestRun, RiskAcceptance, RiskAcceptanceDecision, Ticket, TicketStatus, TicketType } from "@/data/types";
import { requireUserId } from "./common";
import { activityData } from "./activity";
import { riskConversationData } from "./conversations";
import { requestReassessmentWithCompatibility } from "@/data/compatibility/workflow";
import { createDebug } from "@/lib/debug";

const debug = createDebug("data:tickets");

export interface TicketFilters {
  type?: TicketType;
  status?: TicketStatus;
  applicationId?: string;
  assignedTeamId?: string;
  createdBy?: string;
  findingId?: string;
}

export const ticketData = {
  async list(filters: TicketFilters = {}): Promise<Ticket[]> {
    debug("listing tickets", filters);
    let query = supabase.from("tickets").select("*");
    if (filters.type) query = query.eq("type", filters.type);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.applicationId)
      query = query.eq("application_id", filters.applicationId);
    if (filters.assignedTeamId)
      query = query.eq("assigned_team_id", filters.assignedTeamId);
    if (filters.createdBy) query = query.eq("created_by", filters.createdBy);
    if (filters.findingId) query = query.eq("finding_id", filters.findingId);
    const { data, error } = await query.order("updated_at", {
      ascending: false,
    });
    if (error) {
      debug("listing tickets failed", { code: error.code, message: error.message });
      throw error;
    }
    debug("listed tickets", { count: data?.length });
    return data;
  },

  async get(id: string): Promise<Ticket | null> {
    debug("fetching ticket", { id });
    const { data, error } = await supabase
      .from("tickets")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      debug("fetching ticket failed", { id, code: error.code, message: error.message });
      throw error;
    }
    debug("fetched ticket", { id, found: !!data, status: data?.status });
    return data;
  },

  async listWithRelations(
    filters: TicketFilters = {},
  ): Promise<(Ticket & { finding: Finding | null; application: Application | null })[]> {
    debug("listing tickets with relations", filters);
    let query = supabase
      .from("tickets")
      .select("*, finding:findings(*), application:applications(*)");
    if (filters.type) query = query.eq("type", filters.type);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.applicationId)
      query = query.eq("application_id", filters.applicationId);
    if (filters.assignedTeamId)
      query = query.eq("assigned_team_id", filters.assignedTeamId);
    if (filters.createdBy) query = query.eq("created_by", filters.createdBy);
    if (filters.findingId) query = query.eq("finding_id", filters.findingId);
    const { data, error } = await query.order("updated_at", { ascending: false });
    if (error) {
      debug("listing tickets with relations failed", { code: error.code, message: error.message });
      throw error;
    }
    debug("listed tickets with relations", { count: data?.length });
    return data as (Ticket & {
      finding: Finding | null;
      application: Application | null;
    })[];
  },

  async getWithRelations(
    id: string,
  ): Promise<
    (Ticket & { finding: Finding | null; application: Application | null }) | null
  > {
    debug("fetching ticket with relations", { id });
    const { data, error } = await supabase
      .from("tickets")
      .select("*, finding:findings(*), application:applications(*)")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      debug("fetching ticket with relations failed", { id, code: error.code, message: error.message });
      throw error;
    }
    debug("fetched ticket with relations", { id, found: !!data });
    return data as
      | (Ticket & { finding: Finding | null; application: Application | null })
      | null;
  },

  async listByFindingIds(findingIds: string[]): Promise<Ticket[]> {
    if (findingIds.length === 0) {
      debug("no findings; skipping ticket query");
      return [];
    }
    debug("listing tickets for findings", { findings: findingIds.length });
    const { data, error } = await supabase
      .from("tickets")
      .select("*")
      .in("finding_id", findingIds);
    if (error) {
      debug("listing tickets for findings failed", { findings: findingIds.length, code: error.code, message: error.message });
      throw error;
    }
    debug("listed tickets for findings", { findings: findingIds.length, count: data?.length });
    return data;
  },

  async createRemediationTicket(input: {
    finding_id: string;
    application_id: string;
    title: string;
    description?: string;
    target_version?: string;
    assigned_team_id?: string;
    risk_conversation_id?: string | null;
    origin_assessment_id?: string | null;
    selected_control_id?: string | null;
  }): Promise<Ticket> {
    debug("creating remediation ticket", {
      findingId: input.finding_id,
      applicationId: input.application_id,
      conversationId: input.risk_conversation_id ?? null,
      selectedControlId: input.selected_control_id ?? null,
      assignedTeamId: input.assigned_team_id ?? null,
    });
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from("tickets")
      .insert({
        finding_id: input.finding_id,
        application_id: input.application_id,
        type: "remediation",
        status: "open",
        title: input.title,
        description: input.description ?? null,
        target_version: input.target_version ?? null,
        assigned_team_id: input.assigned_team_id ?? null,
        risk_conversation_id: input.risk_conversation_id ?? null,
        origin_assessment_id: input.origin_assessment_id ?? null,
        selected_control_id: input.selected_control_id?.trim() || null,
        created_by: userId,
      })
      .select()
      .single();
    if (error) {
      debug("creating remediation ticket failed", { findingId: input.finding_id, code: error.code, message: error.message });
      throw error;
    }
    debug("created remediation ticket", { ticketId: data?.id });
    if (data.risk_conversation_id) {
      debug("recording remediation start in conversation", {
        ticketId: data.id,
        conversationId: data.risk_conversation_id,
      });
      await riskConversationData.addEntry({
        conversation_id: data.risk_conversation_id,
        kind: "remediation_started",
        source_ticket_id: data.id,
      });
    } else {
      debug("remediation ticket has no conversation; skipping entry", { ticketId: data.id });
    }
    await activityData.log({
      entity_type: "ticket",
      entity_id: data.id,
      action: "ticket_created",
      metadata: { type: "remediation", finding_id: input.finding_id },
    });
    return data;
  },

  async createRiskAcceptanceTicket(input: {
    finding_id: string;
    application_id: string;
    title: string;
    reason: string;
    business_justification?: string;
    compensating_controls?: string;
    expires_at?: string;
  }): Promise<Ticket> {
    debug("creating risk acceptance ticket", {
      findingId: input.finding_id,
      applicationId: input.application_id,
      reasonLength: input.reason.length,
      hasExpiry: !!input.expires_at,
    });
    const userId = await requireUserId();
    const { data: ticket, error } = await supabase
      .from("tickets")
      .insert({
        finding_id: input.finding_id,
        application_id: input.application_id,
        type: "risk_acceptance",
        status: "under_review",
        title: input.title,
        created_by: userId,
      })
      .select()
      .single();
    if (error) {
      debug("creating risk acceptance ticket failed", { findingId: input.finding_id, code: error.code, message: error.message });
      throw error;
    }
    debug("created risk acceptance ticket; recording request", { ticketId: ticket?.id });

    const { error: raError } = await supabase.from("risk_acceptance").insert({
      ticket_id: ticket.id,
      finding_id: input.finding_id,
      requested_by: userId,
      reason: input.reason,
      business_justification: input.business_justification ?? null,
      compensating_controls: input.compensating_controls ?? null,
      expires_at: input.expires_at ?? null,
      decision: "pending",
    });
    if (raError) {
      debug("recording risk acceptance failed", { ticketId: ticket.id, code: raError.code, message: raError.message });
      throw raError;
    }
    debug("recorded risk acceptance request", { ticketId: ticket.id });

    await activityData.log({
      entity_type: "ticket",
      entity_id: ticket.id,
      action: "risk_acceptance_requested",
      metadata: { finding_id: input.finding_id },
    });

    return ticket;
  },

  async createAppProvisioningTicket(input: {
    application_id: string;
    title: string;
    description?: string;
  }): Promise<Ticket> {
    debug("creating app provisioning ticket", { applicationId: input.application_id });
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from("tickets")
      .insert({
        finding_id: null,
        application_id: input.application_id,
        type: "app_provisioning",
        status: "open",
        title: input.title,
        description: input.description ?? null,
        created_by: userId,
      })
      .select()
      .single();
    if (error) {
      debug("creating app provisioning ticket failed", { applicationId: input.application_id, code: error.code, message: error.message });
      throw error;
    }
    debug("created app provisioning ticket", { ticketId: data?.id });
    await activityData.log({
      entity_type: "ticket",
      entity_id: data.id,
      action: "ticket_created",
      metadata: { type: "app_provisioning", application_id: input.application_id },
    });
    return data;
  },

  async updateStatus(ticketId: string, status: TicketStatus): Promise<Ticket> {
    debug("updating ticket status", { ticketId, status });
    if (status === "withdrawn") {
      debug("refusing direct withdrawal; use withdraw()", { ticketId });
      throw new Error("Use ticketData.withdraw() so the reason and actor are recorded.");
    }
    const closed_at = status === "closed" ? new Date().toISOString() : null;
    const { data, error } = await supabase
      .from("tickets")
      .update({
        status,
        closed_at,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ticketId)
      .select()
      .single();
    if (error) {
      debug("updating ticket status failed", { ticketId, status, code: error.code, message: error.message });
      throw error;
    }
    debug("updated ticket status", { ticketId, status: data?.status, closed: !!closed_at });
    await activityData.log({
      entity_type: "ticket",
      entity_id: ticketId,
      action: "ticket_updated",
      metadata: { status },
    });
    return data;
  },

  /**
   * The caller has already checked the id against the controls the backend
   * currently offers; Supabase cannot validate against the playbook catalogue.
   * The status filter makes initialisation idempotent across tabs — a second
   * writer sees the selection already stored and returns it unchanged.
   */
  async setSelectedControl(ticketId: string, controlId: string): Promise<Ticket> {
    const trimmed = controlId.trim();
    debug("selecting remediation control", { ticketId, controlId: trimmed });
    if (!trimmed) {
      debug("refusing empty control id", { ticketId });
      throw new Error("A remediation approach needs a control id.");
    }

    const current = await ticketData.get(ticketId);
    if (!current) {
      debug("ticket not found for control selection", { ticketId });
      throw new Error("That remediation could not be found.");
    }
    if (current.selected_control_id === trimmed) {
      debug("control already selected; unchanged", { ticketId, controlId: trimmed });
      return current;
    }

    const { data, error } = await supabase
      .from("tickets")
      .update({ selected_control_id: trimmed, updated_at: new Date().toISOString() })
      .eq("id", ticketId)
      .select()
      .single();
    if (error) {
      debug("selecting remediation control failed", { ticketId, code: error.code, message: error.message });
      throw error;
    }
    debug("selected remediation control", {
      ticketId,
      controlId: trimmed,
      previousControlId: current.selected_control_id,
    });
    await activityData.log({
      entity_type: "ticket",
      entity_id: ticketId,
      action: "remediation_approach_selected",
      metadata: { control_id: trimmed, previous_control_id: current.selected_control_id },
    });
    return data;
  },

  async withdraw(ticketId: string, reason: string): Promise<Ticket> {
    const trimmed = reason.trim();
    debug("withdrawing remediation", { ticketId, reasonLength: trimmed.length });
    if (!trimmed) {
      debug("refusing withdrawal without reason", { ticketId });
      throw new Error("Withdrawing a remediation needs a reason.");
    }
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from("tickets")
      .update({
        status: "withdrawn",
        withdrawn_at: new Date().toISOString(),
        withdrawn_by: userId,
        withdrawal_reason: trimmed,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ticketId)
      .select()
      .single();
    if (error) {
      debug("withdrawing remediation failed", { ticketId, code: error.code, message: error.message });
      throw error;
    }
    debug("withdrew remediation", { ticketId, conversationId: data?.risk_conversation_id ?? null });
    if (data.risk_conversation_id) {
      await riskConversationData.addEntry({
        conversation_id: data.risk_conversation_id,
        kind: "remediation_withdrawn",
        message: trimmed,
        source_ticket_id: ticketId,
      });
    }
    await activityData.log({
      entity_type: "ticket",
      entity_id: ticketId,
      action: "remediation_withdrawn",
      metadata: { reason: trimmed },
    });
    return data;
  },

  async resume(ticketId: string): Promise<Ticket> {
    debug("resuming remediation", { ticketId });
    const { data, error } = await supabase
      .from("tickets")
      .update({ status: "in_progress", updated_at: new Date().toISOString() })
      .eq("id", ticketId)
      .select()
      .single();
    if (error) {
      debug("resuming remediation failed", { ticketId, code: error.code, message: error.message });
      throw error;
    }
    debug("resumed remediation", { ticketId, status: data?.status });
    await activityData.log({
      entity_type: "ticket",
      entity_id: ticketId,
      action: "remediation_resumed",
    });
    return data;
  },
};

export const retestData = {
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

  async findActiveForConversation(conversationId: string): Promise<RetestRun | null> {
    debug("finding active retest", { conversationId });
    const { data, error } = await supabase
      .from("retest_runs")
      .select("*")
      .eq("conversation_id", conversationId)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      debug("finding active retest failed", { conversationId, code: error.code, message: error.message });
      throw error;
    }
    debug("active retest lookup", { conversationId, runId: data?.id ?? null, status: data?.status });
    return data;
  },

  /**
   * With migration 0030 the whole request is one atomic call keyed on the
   * submission. The path below is the pre-0030 fallback, where the database
   * still allows only one active reassessment per risk and a retry therefore
   * completes the half-finished attempt instead of duplicating it.
   */
  async requestRetest(input: {
    conversationId: string;
    findingId: string;
    ticketId?: string | null;
    /** Optional context, carried on the request event rather than posted twice. */
    message?: string | null;
    /** One intentional Send. A retry of it resolves to the request it already made. */
    submissionId: string;
  }): Promise<{ run: RetestRun; entryId: string }> {
    debug("requesting retest", {
      conversationId: input.conversationId,
      findingId: input.findingId,
      ticketId: input.ticketId ?? null,
      submissionId: input.submissionId,
      messageLength: input.message?.trim().length ?? 0,
    });
    const queued = await requestReassessmentWithCompatibility({
      conversationId: input.conversationId,
      findingId: input.findingId,
      ticketId: input.ticketId ?? null,
      message: input.message?.trim() || null,
      submissionId: input.submissionId,
    });
    if (queued) {
      debug("retest queued via RPC", { runId: queued.run?.id, entryId: queued.entryId });
      return { run: queued.run, entryId: queued.entryId as string };
    }

    debug("reassessment RPC unavailable; using legacy single-active path", {
      conversationId: input.conversationId,
    });
    const userId = await requireUserId();
    let run = await retestData.findActiveForConversation(input.conversationId);
    debug("active retest before insert", { runId: run?.id ?? null, status: run?.status });
    if (!run) {
      debug("no active retest; inserting one", { conversationId: input.conversationId });
      const { data, error } = await supabase
        .from("retest_runs")
        .insert({
          conversation_id: input.conversationId,
          ticket_id: input.ticketId ?? null,
          finding_id: input.findingId,
          requested_by: userId,
          status: "queued",
        })
        .select()
        .single();
      if (error) {
        debug("retest insert failed; checking for concurrent insert", {
          code: error.code,
          message: error.message,
        });
        const raced = await retestData.findActiveForConversation(input.conversationId);
        if (!raced) {
          debug("no concurrent retest found; rethrowing", { conversationId: input.conversationId });
          throw error;
        }
        debug("concurrent retest found; reusing", { runId: raced.id });
        run = raced;
      } else {
        run = data as RetestRun;
        debug("inserted retest", { runId: run?.id });
      }
    }

    const entry = await riskConversationData.addEntryOnce({
      conversation_id: input.conversationId,
      kind: "retest_requested",
      message: input.message?.trim() || null,
      source_ticket_id: input.ticketId ?? null,
      sync_key: `retest-requested::${run.id}`,
    });

    debug("recorded retest request entry", { runId: run.id, entryId: entry?.id });

    if (input.ticketId) {
      const ticket = await ticketData.get(input.ticketId);
      if (ticket && ticket.status !== "retest_requested") {
        debug("moving ticket to retest_requested", { ticketId: input.ticketId, from: ticket.status });
        await ticketData.updateStatus(input.ticketId, "retest_requested");
        await activityData.log({
          entity_type: "ticket",
          entity_id: input.ticketId,
          action: "retest_requested",
        });
      } else {
        debug("ticket status unchanged", { ticketId: input.ticketId, found: !!ticket });
      }
    } else {
      debug("retest has no ticket; skipping status update");
    }
    return { run, entryId: entry.id };
  },

  /**
   * Claims the queued request before any automation starts, so a run can never
   * begin against a request the developer withdrew a moment earlier.
   */
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

  async complete(id: string, result: string, status: "completed" | "failed") {
    debug("completing retest", { retestId: id, status, resultLength: result.length });
    const { data, error } = await supabase
      .from("retest_runs")
      .update({ status, result, completed_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) {
      debug("completing retest failed", { retestId: id, code: error.code, message: error.message });
      throw error;
    }
    debug("completed retest", { retestId: id, status: data?.status });
    return data;
  },
};

export const riskAcceptanceData = {
  async getForTicket(ticketId: string): Promise<RiskAcceptance | null> {
    debug("fetching risk acceptance", { ticketId });
    const { data, error } = await supabase
      .from("risk_acceptance")
      .select("*")
      .eq("ticket_id", ticketId)
      .maybeSingle();
    if (error) {
      debug("fetching risk acceptance failed", { ticketId, code: error.code, message: error.message });
      throw error;
    }
    debug("fetched risk acceptance", { ticketId, found: !!data, decision: data?.decision });
    return data;
  },

  async listPending(): Promise<RiskAcceptance[]> {
    debug("listing pending risk acceptances");
    const { data, error } = await supabase
      .from("risk_acceptance")
      .select("*")
      .eq("decision", "pending")
      .order("created_at", { ascending: false });
    if (error) {
      debug("listing pending risk acceptances failed", { code: error.code, message: error.message });
      throw error;
    }
    debug("listed pending risk acceptances", { count: data?.length });
    return data;
  },

  async review(
    id: string,
    decision: RiskAcceptanceDecision,
    comment?: string,
  ): Promise<RiskAcceptance> {
    debug("reviewing risk acceptance", { id, decision, commentLength: comment?.length ?? 0 });
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from("risk_acceptance")
      .update({
        decision,
        review_comment: comment ?? null,
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();
    if (error) {
      debug("reviewing risk acceptance failed", { id, code: error.code, message: error.message });
      throw error;
    }
    debug("reviewed risk acceptance; updating ticket", { id, ticketId: data?.ticket_id, decision });

    await ticketData.updateStatus(
      data.ticket_id,
      decision === "accepted" ? "accepted" : "rejected",
    );
    await activityData.log({
      entity_type: "ticket",
      entity_id: data.ticket_id,
      action:
        decision === "accepted"
          ? "risk_acceptance_accepted"
          : "risk_acceptance_rejected",
      metadata: { comment },
    });

    return data;
  },
};
