/**
 * Supabase operations on assessments and assessment run requests.
 */

import { supabase } from "@/database/client";
import type {
  Application,
  Assessment,
  AssessmentRunRequest,
} from "@/database/types";
import { createDebug } from "@/lib/debug";

const debug = createDebug("database:assessments");

export const assessmentData = {







  /** Finds any one assessment for the application, or null. */
  async findForApplication(applicationId: string): Promise<Assessment | null> {
    debug("finding assessment for application", { applicationId });
    const { data, error } = await supabase
      .from("assessments")
      .select("*")
      .eq("application_id", applicationId)
      .limit(1)
      .maybeSingle();
    if (error) {
      debug("finding assessment for application failed", {
        applicationId,
        code: error.code,
        message: error.message,
      });
      throw error;
    }
    debug("assessment for application lookup", { applicationId, id: data?.id ?? null });
    return data;
  },

  /** Creates an assessment row. */
  async create(
    assessment: Partial<Assessment> & { external_id: string; application_id: string },
  ): Promise<Assessment> {
    debug("creating assessment", {
      externalId: assessment.external_id,
      applicationId: assessment.application_id,
      status: assessment.status,
    });
    const { data, error } = await supabase.from("assessments").insert(assessment).select().single();
    if (error) {
      debug("creating assessment failed", {
        applicationId: assessment.application_id,
        code: error.code,
        message: error.message,
      });
      throw error;
    }
    debug("created assessment", { id: data?.id });
    return data;
  },

  /** Lists assessments with their application joined, most recently updated first. */
  async listWithApplications(): Promise<
    (Assessment & { application: Application | null })[]
  > {
    debug("listing assessments with applications");
    const { data, error } = await supabase
      .from("assessments")
      .select("*, application:applications(*)")
      .order("updated_at", { ascending: false });
    if (error) {
      debug("listing assessments with applications failed", {
        code: error.code,
        message: error.message,
      });
      throw error;
    }
    debug("listed assessments with applications", { count: data?.length });
    return data as (Assessment & { application: Application | null })[];
  },

  /** Fetches one assessment with its application joined, or null. */
  async getWithApplication(
    id: string,
  ): Promise<(Assessment & { application: Application | null }) | null> {
    debug("fetching assessment with application", { id });
    const { data, error } = await supabase
      .from("assessments")
      .select("*, application:applications(*)")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      debug("fetching assessment with application failed", {
        id,
        code: error.code,
        message: error.message,
      });
      throw error;
    }
    debug("fetched assessment with application", { id, found: !!data });
    return data as (Assessment & { application: Application | null }) | null;
  },
};

export const assessmentRunRequestData = {
  /** Fetches the assessment's latest run request: the active one, or else the most recent. */
  async findForAssessment(assessmentId: string): Promise<AssessmentRunRequest | null> {
    debug("finding run request", { assessmentId });
    const { data, error } = await supabase
      .from("assessment_run_requests")
      .select("*")
      .eq("assessment_id", assessmentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      debug("finding run request failed", { assessmentId, code: error.code, message: error.message });
      throw error;
    }
    debug("run request lookup", { assessmentId, id: data?.id ?? null, status: data?.status });
    return data;
  },

  /** Requests a run; idempotent, since the database returns any request already in flight. */
  async request(assessmentId: string): Promise<AssessmentRunRequest> {
    debug("rpc request_assessment_run", { assessmentId });
    const { data, error } = await supabase.rpc("request_assessment_run", {
      p_assessment_id: assessmentId,
    });
    if (error) {
      debug("rpc request_assessment_run failed", {
        assessmentId,
        code: error.code,
        message: error.message,
      });
      throw error;
    }
    const request = data as AssessmentRunRequest;
    debug("rpc request_assessment_run returned", {
      assessmentId,
      id: request?.id,
      status: request?.status,
    });
    return request;
  },
};
