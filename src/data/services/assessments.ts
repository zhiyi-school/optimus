import { supabase } from "@/data/supabase";
import type { Application, Assessment, AssessmentMessage, AssessmentStatus } from "@/data/types";
import { requireUserId } from "./common";
import { activityData } from "./activity";

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

  /**
   * Moves a queued assessment to `running`, returning it only if this caller
   * won. The `status` filter makes the claim atomic, so concurrent viewers
   * can't each start their own run for the same assessment.
   */
  async claimForRun(assessmentId: string): Promise<Assessment | null> {
    const { data, error } = await supabase
      .from("assessments")
      .update({ status: "running", updated_at: new Date().toISOString() })
      .eq("id", assessmentId)
      .eq("status", "queued")
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async setStatus(assessmentId: string, status: AssessmentStatus): Promise<void> {
    const { error } = await supabase
      .from("assessments")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", assessmentId);
    if (error) throw error;
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

export const assessmentMessageData = {
  async listForAssessment(assessmentId: string): Promise<AssessmentMessage[]> {
    const { data, error } = await supabase
      .from("assessment_messages")
      .select("*")
      .eq("assessment_id", assessmentId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data;
  },

  async send(assessmentId: string, message: string): Promise<AssessmentMessage> {
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from("assessment_messages")
      .insert({ assessment_id: assessmentId, author_id: userId, message })
      .select()
      .single();
    if (error) throw error;
    await activityData.log({
      entity_type: "assessment",
      entity_id: assessmentId,
      action: "message_added",
    });
    return data;
  },

  subscribeToAssessment(assessmentId: string, onChange: () => void) {
    const channel = supabase
      .channel(`assessment-messages-${assessmentId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "assessment_messages",
          filter: `assessment_id=eq.${assessmentId}`,
        },
        onChange,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  },
};
