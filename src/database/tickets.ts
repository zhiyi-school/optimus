/**
 * Supabase operations on tickets: lookups, creation, status, approach, withdrawal and resumption.
 */

import { supabase } from "@/database/client";
import type { Application, Finding, Ticket, TicketStatus, TicketType } from "@/database/types";
import { requireUserId } from "./session";
import { activityData } from "./activity";
import { riskConversationData } from "./conversations";
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
  /** Lists tickets matching the filters, most recently updated first. */
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

  /** Fetches one ticket, or null. */
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

  /** Lists filtered tickets with their finding and application joined. */
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

  /** Fetches one ticket with its finding and application joined, or null. */
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

  /** Creates an open remediation ticket and records its start in the risk conversation. */
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

  /** Creates an open app provisioning ticket. */
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

  /** Sets a ticket's status, stamping `closed_at` on close; withdrawal must use `withdraw()`. */
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

  /** Sets the remediation approach; the caller must validate the id against the backend's live controls. */
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

  /** Withdraws a remediation with a required reason and records it in the conversation. */
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

  /** Moves a remediation back to in progress and logs the resumption. */
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
