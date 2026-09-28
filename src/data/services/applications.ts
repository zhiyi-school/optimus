import { supabase } from "@/data/supabase";
import type { Application } from "@/data/types";
import { createDebug } from "@/lib/debug";
import { activityData } from "./activity";

const debug = createDebug("data:applications");

export const applicationData = {
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

  async get(id: string): Promise<Application | null> {
    debug("fetching application", { id });
    const { data, error } = await supabase
      .from("applications")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      debug("fetching application failed", { id, code: error.code, message: error.message });
      throw error;
    }
    debug("fetched application", { id, found: !!data });
    return data;
  },

  async upsertByExternalId(
    app: Partial<Application> & { external_id: string },
  ): Promise<Application> {
    debug("upserting application by external id", {
      externalId: app.external_id,
      fields: Object.keys(app),
    });
    const { data, error } = await supabase
      .from("applications")
      .upsert(app, { onConflict: "external_id" })
      .select()
      .single();
    if (error) {
      debug("upserting application failed", {
        externalId: app.external_id,
        code: error.code,
        message: error.message,
      });
      throw error;
    }
    debug("upserted application", { id: data?.id, externalId: app.external_id });
    return data;
  },

  /**
   * Finds a manually-created application row (e.g. via "Add App") that's
   * never been linked to a backend app yet (`external_id is null`), matched
   * by name + platform. Used to adopt that row on first real sync instead
   * of creating a second, permanently-duplicate application — see
   * docs/DATABASE.md#manual-assessment-creation.
   */
  async findUnlinkedByNameAndPlatform(
    name: string,
    platform: Application["platform"],
  ): Promise<Application | null> {
    debug("finding unlinked application", { name, platform });
    const { data, error } = await supabase
      .from("applications")
      .select("*")
      .is("external_id", null)
      .eq("platform", platform)
      .ilike("name", name)
      .limit(1)
      .maybeSingle();
    if (error) {
      debug("finding unlinked application failed", {
        name,
        platform,
        code: error.code,
        message: error.message,
      });
      throw error;
    }
    debug("unlinked application lookup", { name, platform, id: data?.id ?? null });
    return data;
  },

  /** Any existing application with this name + platform, linked or not — used to block accidental duplicate creation. */
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

  /** Cascades to every assessment/finding/ticket (and their messages/history/evidence) for this app. */
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
