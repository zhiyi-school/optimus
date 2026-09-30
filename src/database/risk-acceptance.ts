/**
 * Supabase operations on risk acceptance requests and their review decisions.
 */

import { supabase } from "@/database/client";
import type { RiskAcceptance, RiskAcceptanceDecision, Ticket } from "@/database/types";
import { requireUserId } from "./session";
import { activityData } from "./activity";
import { ticketData } from "./tickets";
import { createDebug } from "@/lib/debug";

const debug = createDebug("database:risk-acceptance");

export const riskAcceptanceData = {
  /** Creates a risk acceptance ticket under review with its pending acceptance request. */
  async createTicket(input: {
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

  /** Fetches a ticket's risk acceptance request, or null. */
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

  /** Lists risk acceptance requests awaiting a decision, newest first. */
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

  /** Records a risk acceptance decision and moves the ticket to accepted or rejected. */
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
