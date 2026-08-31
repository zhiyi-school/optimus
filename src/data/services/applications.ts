import { supabase } from "@/data/supabase";
import type { Application } from "@/data/types";
import { activityData } from "./activity";

export const applicationData = {
  async list(): Promise<Application[]> {
    const { data, error } = await supabase
      .from("applications")
      .select("*")
      .order("name");
    if (error) throw error;
    return data;
  },

  async get(id: string): Promise<Application | null> {
    const { data, error } = await supabase
      .from("applications")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async upsertByExternalId(
    app: Partial<Application> & { external_id: string },
  ): Promise<Application> {
    const { data, error } = await supabase
      .from("applications")
      .upsert(app, { onConflict: "external_id" })
      .select()
      .single();
    if (error) throw error;
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
    const { data, error } = await supabase
      .from("applications")
      .select("*")
      .is("external_id", null)
      .eq("platform", platform)
      .ilike("name", name)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /** Any existing application with this name + platform, linked or not — used to block accidental duplicate creation. */
  async findByNameAndPlatform(
    name: string,
    platform: Application["platform"],
  ): Promise<Application | null> {
    const { data, error } = await supabase
      .from("applications")
      .select("*")
      .eq("platform", platform)
      .ilike("name", name)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async create(
    app: Partial<Application> & { name: string; platform: Application["platform"] },
  ): Promise<Application> {
    const { data, error } = await supabase.from("applications").insert(app).select().single();
    if (error) throw error;
    return data;
  },

  async update(applicationId: string, patch: Partial<Application>): Promise<Application> {
    const { data, error } = await supabase
      .from("applications")
      .update(patch)
      .eq("id", applicationId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /** Cascades to every assessment/finding/ticket (and their messages/history/evidence) for this app. */
  async remove(applicationId: string, applicationName: string): Promise<void> {
    const { error } = await supabase.from("applications").delete().eq("id", applicationId);
    if (error) throw error;
    await activityData.log({
      entity_type: "application",
      entity_id: applicationId,
      action: "application_deleted",
      metadata: { name: applicationName },
    });
  },
};
