import { supabase } from "@/data/supabase";
import type {
  ControlProgressStatus,
  TicketControl,
  TicketControlStep,
} from "@/data/types";
import { requireUserId } from "./common";
import { activityData } from "./activity";

export interface ControlReconciliation {
  control_id: string;
  step_keys: string[];
}

function completionFields(status: ControlProgressStatus, userId: string) {
  const completed = status === "completed";
  return {
    status,
    completed_at: completed ? new Date().toISOString() : null,
    completed_by: completed ? userId : null,
  };
}

export const controlProgressData = {
  async listForTicket(ticketId: string): Promise<TicketControl[]> {
    const { data, error } = await supabase
      .from("ticket_controls")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("control_id", { ascending: true });
    if (error) throw error;
    return data;
  },

  async listForTicketIds(ticketIds: string[]): Promise<TicketControl[]> {
    if (ticketIds.length === 0) return [];
    const { data, error } = await supabase
      .from("ticket_controls")
      .select("*")
      .in("ticket_id", ticketIds);
    if (error) throw error;
    return data;
  },

  async listStepsForControlIds(controlRowIds: string[]): Promise<TicketControlStep[]> {
    if (controlRowIds.length === 0) return [];
    const { data, error } = await supabase
      .from("ticket_control_steps")
      .select("*")
      .in("ticket_control_id", controlRowIds)
      .order("step_key", { ascending: true });
    if (error) throw error;
    return data;
  },

  async listSteps(ticketControlId: string): Promise<TicketControlStep[]> {
    const { data, error } = await supabase
      .from("ticket_control_steps")
      .select("*")
      .eq("ticket_control_id", ticketControlId)
      .order("step_key", { ascending: true });
    if (error) throw error;
    return data;
  },

  async listStepsForTicket(ticketId: string): Promise<TicketControlStep[]> {
    const controls = await controlProgressData.listForTicket(ticketId);
    if (controls.length === 0) return [];
    const { data, error } = await supabase
      .from("ticket_control_steps")
      .select("*")
      .in(
        "ticket_control_id",
        controls.map((control) => control.id),
      )
      .order("step_key", { ascending: true });
    if (error) throw error;
    return data;
  },

  /** Adds only: nothing is updated or removed, so a step that left the playbook keeps its history. */
  async reconcile(
    ticketId: string,
    live: ControlReconciliation[],
  ): Promise<TicketControl[]> {
    if (live.length === 0) return controlProgressData.listForTicket(ticketId);

    const existing = await controlProgressData.listForTicket(ticketId);
    const known = new Set(existing.map((control) => control.control_id));
    const missing = live.filter((control) => !known.has(control.control_id));

    if (missing.length > 0) {
      const { error } = await supabase.from("ticket_controls").upsert(
        missing.map((control) => ({ ticket_id: ticketId, control_id: control.control_id })),
        { onConflict: "ticket_id,control_id", ignoreDuplicates: true },
      );
      if (error) throw error;
    }

    const controls = await controlProgressData.listForTicket(ticketId);
    const byControlId = new Map(controls.map((control) => [control.control_id, control]));
    const storedSteps = await controlProgressData.listStepsForControlIds(
      controls.map((control) => control.id),
    );

    const stepRows = [];
    for (const control of live) {
      const row = byControlId.get(control.control_id);
      if (!row) continue;
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
      const { error } = await supabase
        .from("ticket_control_steps")
        .upsert(stepRows, { onConflict: "ticket_control_id,step_key", ignoreDuplicates: true });
      if (error) throw error;
    }

    return controls;
  },

  async setStepStatus(
    ticketId: string,
    stepId: string,
    status: ControlProgressStatus,
    note?: string,
  ): Promise<TicketControlStep> {
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
    if (error) throw error;

    await activityData.log({
      entity_type: "ticket",
      entity_id: ticketId,
      action: "control_step_updated",
      metadata: { step_key: data.step_key, status },
    });
    return data;
  },

  async setControlStatus(
    ticketId: string,
    controlRowId: string,
    status: ControlProgressStatus,
    note?: string,
  ): Promise<TicketControl> {
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from("ticket_controls")
      .update({
        ...completionFields(status, userId),
        ...(note === undefined ? {} : { developer_note: note || null }),
      })
      .eq("id", controlRowId)
      .select()
      .single();
    if (error) throw error;

    await activityData.log({
      entity_type: "ticket",
      entity_id: ticketId,
      action: "control_updated",
      metadata: { control_id: data.control_id, status },
    });
    return data;
  },
};
