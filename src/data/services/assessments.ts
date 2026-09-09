import { supabase } from "@/data/supabase";
import type {
  Application,
  Assessment,
  AssessmentRunRequest,
} from "@/data/types";

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

export const assessmentRunRequestData = {
  /** The one active request, or the most recent if none is active. */
  async findForAssessment(assessmentId: string): Promise<AssessmentRunRequest | null> {
    const { data, error } = await supabase
      .from("assessment_run_requests")
      .select("*")
      .eq("assessment_id", assessmentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /**
   * Idempotent by design: the database returns the request already in flight
   * rather than opening a second one, so a double click cannot queue two runs.
   */
  async request(assessmentId: string): Promise<AssessmentRunRequest> {
    const { data, error } = await supabase.rpc("request_assessment_run", {
      p_assessment_id: assessmentId,
    });
    if (error) throw error;
    return data as AssessmentRunRequest;
  },
};
