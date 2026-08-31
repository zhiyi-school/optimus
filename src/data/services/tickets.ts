import { supabase, ATTACHMENTS_BUCKET } from "@/data/supabase";
import type { Application, Finding, RetestRun, RiskAcceptance, RiskAcceptanceDecision, Ticket, TicketAttachment, TicketMessage, TicketStatus, TicketType } from "@/data/types";
import { requireUserId } from "./common";
import { activityData } from "./activity";

export interface TicketFilters {
  type?: TicketType;
  status?: TicketStatus;
  applicationId?: string;
  assignedTeamId?: string;
  createdBy?: string;
  findingId?: string;
}

export const messageData = {
  async listForTicket(ticketId: string): Promise<TicketMessage[]> {
    const { data, error } = await supabase
      .from("ticket_messages")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data;
  },

  async send(ticketId: string, message: string): Promise<TicketMessage> {
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from("ticket_messages")
      .insert({ ticket_id: ticketId, author_id: userId, message })
      .select()
      .single();
    if (error) throw error;
    await activityData.log({
      entity_type: "ticket",
      entity_id: ticketId,
      action: "message_added",
    });
    return data;
  },

  subscribeToTicket(ticketId: string, onChange: () => void) {
    const channel = supabase
      .channel(`ticket-messages-${ticketId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ticket_messages",
          filter: `ticket_id=eq.${ticketId}`,
        },
        onChange,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  },
};

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
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw error;
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
    await messageData.send(ticketId, input.notes);
    await activityData.log({
      entity_type: "ticket",
      entity_id: ticketId,
      action: "fix_submitted",
    });
    return data;
  },
};

export const attachmentData = {
  async listForTicket(ticketId: string): Promise<TicketAttachment[]> {
    const { data, error } = await supabase
      .from("ticket_attachments")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data;
  },

  async upload(
    ticketId: string,
    file: File,
    messageId?: string,
  ): Promise<TicketAttachment> {
    const userId = await requireUserId();
    const storagePath = `${ticketId}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(storagePath, file);
    if (uploadError) throw uploadError;

    const { data, error } = await supabase
      .from("ticket_attachments")
      .insert({
        ticket_id: ticketId,
        message_id: messageId ?? null,
        uploaded_by: userId,
        storage_path: storagePath,
        file_name: file.name,
        mime_type: file.type || null,
      })
      .select()
      .single();
    if (error) throw error;

    await activityData.log({
      entity_type: "ticket",
      entity_id: ticketId,
      action: "evidence_added",
      metadata: { file_name: file.name },
    });

    return data;
  },

  getSignedUrl(storagePath: string) {
    return supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrl(storagePath, 3600);
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

  async listForTicket(ticketId: string): Promise<RetestRun[]> {
    const { data, error } = await supabase
      .from("retest_runs")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  },

  async requestRetest(ticketId: string, findingId: string): Promise<RetestRun> {
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from("retest_runs")
      .insert({
        ticket_id: ticketId,
        finding_id: findingId,
        requested_by: userId,
        status: "queued",
      })
      .select()
      .single();
    if (error) throw error;

    await ticketData.updateStatus(ticketId, "retest_requested");
    await activityData.log({
      entity_type: "ticket",
      entity_id: ticketId,
      action: "retest_requested",
    });
    return data;
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
