/**
 * Supabase operations on applications.
 */

import { supabase } from "@/data/supabase";
import type { Application } from "@/data/types";
import { createDebug } from "@/lib/debug";
import { activityData } from "./activity";

const debug = createDebug("data:applications");

export const applicationData = {
  /** Lists every visible application by name. */
  async list(): Promise<Application[]> {
    debug("listing applications");
    const { data, error } = await supabase
      .from("applications")
      .select("*")
      .order("name");
    if (error) {
      debug("listing applications failed", { code: error.code, message: error.message });
      throw error;
    }
    debug("listed applications", { count: data?.length });
    return data;
  },




  /** Finds any app with this name and platform, linked or not, to block duplicate creation. */
  async findByNameAndPlatform(
    name: string,
    platform: Application["platform"],
  ): Promise<Application | null> {
    debug("finding application by name", { name, platform });
    const { data, error } = await supabase
      .from("applications")
      .select("*")
      .eq("platform", platform)
      .ilike("name", name)
      .limit(1)
      .maybeSingle();
    if (error) {
      debug("finding application by name failed", {
        name,
        platform,
        code: error.code,
        message: error.message,
      });
      throw error;
    }
    debug("application by name lookup", { name, platform, id: data?.id ?? null });
    return data;
  },

  /** Creates an application row. */
  async create(
    app: Partial<Application> & { name: string; platform: Application["platform"] },
  ): Promise<Application> {
    debug("creating application", { name: app.name, platform: app.platform, fields: Object.keys(app) });
    const { data, error } = await supabase.from("applications").insert(app).select().single();
    if (error) {
      debug("creating application failed", { name: app.name, code: error.code, message: error.message });
      throw error;
    }
    debug("created application", { id: data?.id });
    return data;
  },

  /** Applies a partial update to an application. */
  async update(applicationId: string, patch: Partial<Application>): Promise<Application> {
    debug("updating application", { applicationId, fields: Object.keys(patch) });
    const { data, error } = await supabase
      .from("applications")
      .update(patch)
      .eq("id", applicationId)
      .select()
      .single();
    if (error) {
      debug("updating application failed", {
        applicationId,
        code: error.code,
        message: error.message,
      });
      throw error;
    }
    debug("updated application", { applicationId });
    return data;
  },

  /** Deletes an app, cascading to its assessments, findings and tickets, and logs the deletion. */
  async remove(applicationId: string, applicationName: string): Promise<void> {
    debug("deleting application", { applicationId });
    const { error } = await supabase.from("applications").delete().eq("id", applicationId);
    if (error) {
      debug("deleting application failed", { applicationId, code: error.code, message: error.message });
      throw error;
    }
    debug("deleted application", { applicationId });
    await activityData.log({
      entity_type: "application",
      entity_id: applicationId,
      action: "application_deleted",
      metadata: { name: applicationName },
    });
  },
};
