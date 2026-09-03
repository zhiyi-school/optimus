import { supabase } from "@/data/supabase";
import type { Application, Finding, RetestRun, RiskAcceptance, RiskAcceptanceDecision, Ticket, TicketStatus, TicketType } from "@/data/types";
import { requireUserId } from "./common";
import { activityData } from "./activity";
import { riskConversationData } from "./assessments";

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
    if (error) throw error;
    return data;
  },

  async get(id: string): Promise<Ticket | null> {
    const { data, error } = await supabase
      .from("tickets")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async listWithRelations(
    filters: TicketFilters = {},
  ): Promise<(Ticket & { finding: Finding | null; application: Application | null })[]> {
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
    if (error) throw error;
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
    const { data, error } = await supabase
      .from("tickets")
      .select("*, finding:findings(*), application:applications(*)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data as
      | (Ticket & { finding: Finding | null; application: Application | null })
      | null;
  },

  async listByFindingIds(findingIds: string[]): Promise<Ticket[]> {
    if (findingIds.length === 0) return [];
    const { data, error } = await supabase
      .from("tickets")
      .select("*")
      .in("finding_id", findingIds);
    if (error) throw error;
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
    if (error) throw error;
    if (data.risk_conversation_id) {
      await riskConversationData.addEntry({
        conversation_id: data.risk_conversation_id,
        kind: "remediation_started",
        source_ticket_id: data.id,
      });
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
    if (error) throw error;

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
    if (raError) throw raError;

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
    if (error) throw error;
    await activityData.log({
      entity_type: "ticket",
      entity_id: data.id,
      action: "ticket_created",
      metadata: { type: "app_provisioning", application_id: input.application_id },
    });
    return data;
  },

  async updateStatus(ticketId: string, status: TicketStatus): Promise<Ticket> {
    if (status === "withdrawn") {
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
    if (error) throw error;
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
    if (!trimmed) throw new Error("A remediation approach needs a control id.");

    const current = await ticketData.get(ticketId);
    if (!current) throw new Error("That remediation could not be found.");
    if (current.selected_control_id === trimmed) return current;

    const { data, error } = await supabase
      .from("tickets")
      .update({ selected_control_id: trimmed, updated_at: new Date().toISOString() })
      .eq("id", ticketId)
      .select()
      .single();
    if (error) throw error;
    await activityData.log({
      entity_type: "ticket",
      entity_id: ticketId,
      action: "remediation_approach_selected",
      metadata: { control_id: trimmed, previous_control_id: current.selected_control_id },
    });
    return data;
  },

  async submitFix(
    ticketId: string,
    input: { notes: string; target_version?: string },
  ): Promise<Ticket> {
    const { data, error } = await supabase
      .from("tickets")
      .update({
        status: "fix_submitted",
        target_version: input.target_version ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ticketId)
      .select()
      .single();
    if (error) throw error;
    if (data.risk_conversation_id) {
      await riskConversationData.addEntry({
        conversation_id: data.risk_conversation_id,
        kind: "fix_submitted",
        message: input.notes,
        source_ticket_id: ticketId,
      });
    }
    await activityData.log({
      entity_type: "ticket",
      entity_id: ticketId,
      action: "fix_submitted",
    });
    return data;
  },

  async withdraw(ticketId: string, reason: string): Promise<Ticket> {
    const trimmed = reason.trim();
    if (!trimmed) throw new Error("Withdrawing a remediation needs a reason.");
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
    if (error) throw error;
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
    const { data, error } = await supabase
      .from("tickets")
      .update({ status: "in_progress", updated_at: new Date().toISOString() })
      .eq("id", ticketId)
      .select()
      .single();
    if (error) throw error;
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
    const { data, error } = await supabase
      .from("retest_runs")
      .select("*")
      .eq("finding_id", findingId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  },

  async findActiveForConversation(conversationId: string): Promise<RetestRun | null> {
    const { data, error } = await supabase
      .from("retest_runs")
      .select("*")
      .eq("conversation_id", conversationId)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /**
   * A ticket-originated request keeps its ticket, so the linked remediation
   * still transitions. Every step is safe to repeat: the database allows one
   * active reassessment per risk, the conversation event is keyed to the run,
   * and a ticket already in `retest_requested` is left alone. A retry after a
   * half-finished attempt therefore completes it instead of duplicating it.
   */
  async requestRetest(input: {
    conversationId: string;
    findingId: string;
    ticketId?: string | null;
  }): Promise<RetestRun> {
    const userId = await requireUserId();
    let run = await retestData.findActiveForConversation(input.conversationId);
    if (!run) {
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
        const raced = await retestData.findActiveForConversation(input.conversationId);
        if (!raced) throw error;
        run = raced;
      } else {
        run = data as RetestRun;
      }
    }

    await riskConversationData.addEntryOnce({
      conversation_id: input.conversationId,
      kind: "retest_requested",
      source_ticket_id: input.ticketId ?? null,
      sync_key: `retest-requested::${run.id}`,
    });

    if (input.ticketId) {
      const ticket = await ticketData.get(input.ticketId);
      if (ticket && ticket.status !== "retest_requested") {
        await ticketData.updateStatus(input.ticketId, "retest_requested");
        await activityData.log({
          entity_type: "ticket",
          entity_id: input.ticketId,
          action: "retest_requested",
        });
      }
    }
    return run;
  },

  async markRunning(id: string, externalTestRunId: string): Promise<RetestRun> {
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from("retest_runs")
      .update({
        status: "running",
        executed_by: userId,
        external_test_run_id: externalTestRunId,
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
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
    const { data, error } = await supabase
      .from("retest_runs")
      .update({ status, result, completed_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};

export const riskAcceptanceData = {
  async getForTicket(ticketId: string): Promise<RiskAcceptance | null> {
    const { data, error } = await supabase
      .from("risk_acceptance")
      .select("*")
      .eq("ticket_id", ticketId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async listPending(): Promise<RiskAcceptance[]> {
    const { data, error } = await supabase
      .from("risk_acceptance")
      .select("*")
      .eq("decision", "pending")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  },

  async review(
    id: string,
    decision: RiskAcceptanceDecision,
    comment?: string,
  ): Promise<RiskAcceptance> {
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
    if (error) throw error;

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
