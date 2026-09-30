/**
 * Supabase operations on a ticket's control and step progress.
 */

import { supabase } from "@/database/client";
import type {
  ControlProgressStatus,
  ControlReconciliation,
  TicketControl,
  TicketControlStep,
} from "@/database/types";
import { createDebug } from "@/lib/debug";
import { requireUserId } from "./session";
import { activityData } from "./activity";

const debug = createDebug("database:controls");

/** Status fields to write, stamping completion time and user only when completed. */
function completionFields(status: ControlProgressStatus, userId: string) {
  const completed = status === "completed";
  return {
    status,
    completed_at: completed ? new Date().toISOString() : null,
    completed_by: completed ? userId : null,
  };
}

export const controlProgressData = {
  /** Lists a ticket's control rows by control id. */
  async listForTicket(ticketId: string): Promise<TicketControl[]> {
    debug("listing ticket controls", { ticketId });
    const { data, error } = await supabase
      .from("ticket_controls")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("control_id", { ascending: true });
    if (error) {
      debug("listing ticket controls failed", { ticketId, code: error.code, message: error.message });
      throw error;
    }
    debug("listed ticket controls", { ticketId, count: data?.length });
    return data;
  },

  /** Lists the control rows of several tickets. */
  async listForTicketIds(ticketIds: string[]): Promise<TicketControl[]> {
    if (ticketIds.length === 0) {
      debug("no tickets; skipping control query");
      return [];
    }
    debug("listing controls for tickets", { tickets: ticketIds.length });
    const { data, error } = await supabase
      .from("ticket_controls")
      .select("*")
      .in("ticket_id", ticketIds);
    if (error) {
      debug("listing controls for tickets failed", {
        tickets: ticketIds.length,
        code: error.code,
        message: error.message,
      });
      throw error;
    }
    debug("listed controls for tickets", { tickets: ticketIds.length, count: data?.length });
    return data;
  },

  /** Lists the step rows of several control rows by step key. */
  async listStepsForControlIds(controlRowIds: string[]): Promise<TicketControlStep[]> {
    if (controlRowIds.length === 0) {
      debug("no control rows; skipping step query");
      return [];
    }
    debug("listing steps for controls", { controls: controlRowIds.length });
    const { data, error } = await supabase
      .from("ticket_control_steps")
      .select("*")
      .in("ticket_control_id", controlRowIds)
      .order("step_key", { ascending: true });
    if (error) {
      debug("listing steps for controls failed", {
        controls: controlRowIds.length,
        code: error.code,
        message: error.message,
      });
      throw error;
    }
    debug("listed steps for controls", { controls: controlRowIds.length, count: data?.length });
    return data;
  },


  /** Lists every step row across a ticket's controls. */
  async listStepsForTicket(ticketId: string): Promise<TicketControlStep[]> {
    debug("listing steps for ticket", { ticketId });
    const controls = await controlProgressData.listForTicket(ticketId);
    if (controls.length === 0) {
      debug("ticket has no controls; no steps", { ticketId });
      return [];
    }
    const { data, error } = await supabase
      .from("ticket_control_steps")
      .select("*")
      .in(
        "ticket_control_id",
        controls.map((control) => control.id),
      )
      .order("step_key", { ascending: true });
    if (error) {
      debug("listing steps for ticket failed", { ticketId, code: error.code, message: error.message });
      throw error;
    }
    debug("listed steps for ticket", { ticketId, controls: controls.length, count: data?.length });
    return data;
  },

  /** Adds rows for live controls and steps the ticket lacks; never updates or removes, preserving history. */
  async reconcile(
    ticketId: string,
    live: ControlReconciliation[],
  ): Promise<TicketControl[]> {
    debug("reconciling ticket controls", { ticketId, liveControls: live.length });
    if (live.length === 0) {
      debug("no live controls; returning stored controls", { ticketId });
      return controlProgressData.listForTicket(ticketId);
    }

    const existing = await controlProgressData.listForTicket(ticketId);
    const known = new Set(existing.map((control) => control.control_id));
    const missing = live.filter((control) => !known.has(control.control_id));

    if (missing.length > 0) {
      debug("adding missing controls", {
        ticketId,
        controlIds: missing.map((control) => control.control_id),
      });
      const { error } = await supabase.from("ticket_controls").upsert(
        missing.map((control) => ({ ticket_id: ticketId, control_id: control.control_id })),
        { onConflict: "ticket_id,control_id", ignoreDuplicates: true },
      );
      if (error) {
        debug("adding missing controls failed", { ticketId, code: error.code, message: error.message });
        throw error;
      }
    } else {
      debug("all live controls already stored", { ticketId, stored: existing.length });
    }

    const controls = await controlProgressData.listForTicket(ticketId);
    const byControlId = new Map(controls.map((control) => [control.control_id, control]));
    const storedSteps = await controlProgressData.listStepsForControlIds(
      controls.map((control) => control.id),
    );

    const stepRows = [];
    for (const control of live) {
      const row = byControlId.get(control.control_id);
      if (!row) {
        debug("control row not found after upsert; skipping its steps", {
          ticketId,
          controlId: control.control_id,
        });
        continue;
      }
      const seen = new Set(
        storedSteps.filter((step) => step.ticket_control_id === row.id).map((step) => step.step_key),
      );
      for (const stepKey of control.step_keys) {
        if (seen.has(stepKey)) continue;
        seen.add(stepKey);
        stepRows.push({ ticket_control_id: row.id, step_key: stepKey });
      }
    }

    if (stepRows.length > 0) {
      debug("adding missing steps", { ticketId, steps: stepRows.length });
      const { error } = await supabase
        .from("ticket_control_steps")
        .upsert(stepRows, { onConflict: "ticket_control_id,step_key", ignoreDuplicates: true });
      if (error) {
        debug("adding missing steps failed", { ticketId, code: error.code, message: error.message });
        throw error;
      }
    } else {
      debug("all live steps already stored", { ticketId, stored: storedSteps.length });
    }

    debug("reconciled ticket controls", { ticketId, controls: controls.length });
    return controls;
  },

  /** Sets a step's status and optional note, then logs the change. */
  async setStepStatus(
    ticketId: string,
    stepId: string,
    status: ControlProgressStatus,
    note?: string,
  ): Promise<TicketControlStep> {
    debug("setting step status", { ticketId, stepId, status, noteLength: note?.length ?? null });
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from("ticket_control_steps")
      .update({
        ...completionFields(status, userId),
        ...(note === undefined ? {} : { developer_note: note || null }),
      })
      .eq("id", stepId)
      .select()
      .single();
    if (error) {
      debug("setting step status failed", { stepId, code: error.code, message: error.message });
      throw error;
    }
    debug("set step status", { stepId, stepKey: data?.step_key, status: data?.status });

    await activityData.log({
      entity_type: "ticket",
      entity_id: ticketId,
      action: "control_step_updated",
      metadata: { step_key: data.step_key, status },
    });
    return data;
  },
};
