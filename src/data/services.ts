import { supabase, ATTACHMENTS_BUCKET, EVIDENCE_BUCKET } from "@/data/supabase";
import { UserFacingError } from "@/lib/utils";
import type {
  Application,
  Assessment,
  AssessmentMessage,
  AssessmentStatus,
  ActivityLogEntry,
  Evidence,
  Finding,
  FindingHistory,
  FindingStatus,
  Profile,
  RetestRun,
  RiskAcceptance,
  RiskAcceptanceDecision,
  Team,
  Ticket,
  TicketAttachment,
  TicketMessage,
  TicketStatus,
  TicketType,
} from "@/data/types";

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new UserFacingError("Not authenticated.");
  return data.user.id;
}

export const activityData = {
  async log(entry: {
    entity_type: string;
    entity_id: string;
    action: string;
    metadata?: Record<string, unknown>;
  }) {
    const actor_id = await requireUserId().catch(() => null);
    const { error } = await supabase.from("activity_log").insert({
      actor_id,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id,
      action: entry.action,
      metadata: entry.metadata ?? null,
    });
    if (error) throw error;
  },

  async listForEntity(
    entityType: string,
    entityId: string,
  ): Promise<ActivityLogEntry[]> {
    const { data, error } = await supabase
      .from("activity_log")
      .select("*")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  },
};

export const userData = {
  async getCurrentProfile(): Promise<Profile | null> {
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async listProfiles(): Promise<Profile[]> {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("display_name");
    if (error) throw error;
    return data;
  },

  async updateTeam(profileId: string, teamId: string | null): Promise<Profile> {
    const { data, error } = await supabase
      .from("profiles")
      .update({ team_id: teamId })
      .eq("id", profileId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async setActive(profileId: string, isActive: boolean): Promise<Profile> {
    const { data, error } = await supabase
      .from("profiles")
      .update({ is_active: isActive })
      .eq("id", profileId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /** Admin-only; the database also refuses a user changing their own roles. */
  async updateRoles(profileId: string, roles: Profile["roles"]): Promise<Profile> {
    const { data, error } = await supabase
      .from("profiles")
      .update({ roles })
      .eq("id", profileId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};

export const teamData = {
  async list(): Promise<Team[]> {
    const { data, error } = await supabase.from("teams").select("*").order("name");
    if (error) throw error;
    return data;
  },

  async create(team: { name: string; type: Team["type"] }): Promise<Team> {
    const { data, error } = await supabase.from("teams").insert(team).select().single();
    if (error) throw error;
    return data;
  },
};

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

export interface FindingFilters {
  status?: FindingStatus;
  applicationId?: string;
  platform?: string;
  severity?: string;
  search?: string;
}

export const findingData = {
  async list(filters: FindingFilters = {}): Promise<Finding[]> {
    let query = supabase.from("findings").select("*");
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.applicationId)
      query = query.eq("application_id", filters.applicationId);
    if (filters.platform) query = query.eq("platform", filters.platform);
    if (filters.severity) query = query.eq("severity", filters.severity);
    if (filters.search) query = query.ilike("title", `%${filters.search}%`);
    const { data, error } = await query.order("created_at", {
      ascending: false,
    });
    if (error) throw error;
    return data;
  },

  async get(id: string): Promise<Finding | null> {
    const { data, error } = await supabase
      .from("findings")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async listWithApplication(
    filters: FindingFilters = {},
  ): Promise<(Finding & { application: Application | null })[]> {
    let query = supabase.from("findings").select("*, application:applications(*)");
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.applicationId)
      query = query.eq("application_id", filters.applicationId);
    if (filters.platform) query = query.eq("platform", filters.platform);
    if (filters.severity) query = query.eq("severity", filters.severity);
    if (filters.search) query = query.ilike("title", `%${filters.search}%`);
    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) throw error;
    return data as (Finding & { application: Application | null })[];
  },

  async getWithApplication(
    id: string,
  ): Promise<(Finding & { application: Application | null }) | null> {
    const { data, error } = await supabase
      .from("findings")
      .select("*, application:applications(*)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data as (Finding & { application: Application | null }) | null;
  },

  async history(findingId: string): Promise<FindingHistory[]> {
    const { data, error } = await supabase
      .from("finding_history")
      .select("*")
      .eq("finding_id", findingId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  },

  async upsertByExternalId(
    finding: Partial<Finding> & { external_id: string },
  ): Promise<Finding> {
    const { data, error } = await supabase
      .from("findings")
      .upsert(finding, { onConflict: "external_id" })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateStatus(
    findingId: string,
    newStatus: FindingStatus,
    reason?: string,
  ): Promise<Finding> {
    const current = await findingData.get(findingId);
    const userId = await requireUserId();

    const { data, error } = await supabase
      .from("findings")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", findingId)
      .select()
      .single();
    if (error) throw error;

    await supabase.from("finding_history").insert({
      finding_id: findingId,
      previous_status: current?.status ?? null,
      new_status: newStatus,
      changed_by: userId,
      reason: reason ?? null,
    });

    await activityData.log({
      entity_type: "finding",
      entity_id: findingId,
      action: "finding_status_changed",
      metadata: { previous_status: current?.status, new_status: newStatus },
    });

    return data;
  },
};

export interface TicketFilters {
  type?: TicketType;
  status?: TicketStatus;
  applicationId?: string;
  assignedTeamId?: string;
  createdBy?: string;
  findingId?: string;
}

export const ticketData = {
  async list(filters: TicketFilters = {}): Promise<Ticket[]> {
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
    if (error) throw error;
    return data;
  },

  async get(id: string): Promise<Ticket | null> {
    const { data, error } = await supabase
      .from("tickets")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async listWithRelations(
    filters: TicketFilters = {},
  ): Promise<(Ticket & { finding: Finding | null; application: Application | null })[]> {
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
    if (error) throw error;
    return data as (Ticket & {
      finding: Finding | null;
      application: Application | null;
    })[];
  },

  async getWithRelations(
    id: string,
  ): Promise<
    (Ticket & { finding: Finding | null; application: Application | null }) | null
  > {
    const { data, error } = await supabase
      .from("tickets")
      .select("*, finding:findings(*), application:applications(*)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data as
      | (Ticket & { finding: Finding | null; application: Application | null })
      | null;
  },

  async listByFindingIds(findingIds: string[]): Promise<Ticket[]> {
    if (findingIds.length === 0) return [];
    const { data, error } = await supabase
      .from("tickets")
      .select("*")
      .in("finding_id", findingIds);
    if (error) throw error;
    return data;
  },

  async createRemediationTicket(input: {
    finding_id: string;
    application_id: string;
    title: string;
    description?: string;
    target_version?: string;
    assigned_team_id?: string;
  }): Promise<Ticket> {
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
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw error;
    await activityData.log({
      entity_type: "ticket",
      entity_id: data.id,
      action: "ticket_created",
      metadata: { type: "remediation", finding_id: input.finding_id },
    });
    return data;
  },

  async createRiskAcceptanceTicket(input: {
    finding_id: string;
    application_id: string;
    title: string;
    reason: string;
    business_justification?: string;
    compensating_controls?: string;
    expires_at?: string;
  }): Promise<Ticket> {
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
    if (error) throw error;

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
    if (raError) throw raError;

    await activityData.log({
      entity_type: "ticket",
      entity_id: ticket.id,
      action: "risk_acceptance_requested",
      metadata: { finding_id: input.finding_id },
    });

    return ticket;
  },

  async createAppProvisioningTicket(input: {
    application_id: string;
    title: string;
    description?: string;
  }): Promise<Ticket> {
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
    if (error) throw error;
    await activityData.log({
      entity_type: "ticket",
      entity_id: data.id,
      action: "ticket_created",
      metadata: { type: "app_provisioning", application_id: input.application_id },
    });
    return data;
  },

  async updateStatus(ticketId: string, status: TicketStatus): Promise<Ticket> {
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
    if (error) throw error;
    await activityData.log({
      entity_type: "ticket",
      entity_id: ticketId,
      action: "ticket_updated",
      metadata: { status },
    });
    return data;
  },

  async submitFix(
    ticketId: string,
    input: { notes: string; target_version?: string },
  ): Promise<Ticket> {
    const { data, error } = await supabase
      .from("tickets")
      .update({
        status: "fix_submitted",
        target_version: input.target_version ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ticketId)
      .select()
      .single();
    if (error) throw error;
    await messageData.send(ticketId, input.notes);
    await activityData.log({
      entity_type: "ticket",
      entity_id: ticketId,
      action: "fix_submitted",
    });
    return data;
  },
};

export const messageData = {
  async listForTicket(ticketId: string): Promise<TicketMessage[]> {
    const { data, error } = await supabase
      .from("ticket_messages")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data;
  },

  async send(ticketId: string, message: string): Promise<TicketMessage> {
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from("ticket_messages")
      .insert({ ticket_id: ticketId, author_id: userId, message })
      .select()
      .single();
    if (error) throw error;
    await activityData.log({
      entity_type: "ticket",
      entity_id: ticketId,
      action: "message_added",
    });
    return data;
  },

  subscribeToTicket(ticketId: string, onChange: () => void) {
    const channel = supabase
      .channel(`ticket-messages-${ticketId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ticket_messages",
          filter: `ticket_id=eq.${ticketId}`,
        },
        onChange,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  },
};

export const attachmentData = {
  async listForTicket(ticketId: string): Promise<TicketAttachment[]> {
    const { data, error } = await supabase
      .from("ticket_attachments")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data;
  },

  async upload(
    ticketId: string,
    file: File,
    messageId?: string,
  ): Promise<TicketAttachment> {
    const userId = await requireUserId();
    const storagePath = `${ticketId}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(storagePath, file);
    if (uploadError) throw uploadError;

    const { data, error } = await supabase
      .from("ticket_attachments")
      .insert({
        ticket_id: ticketId,
        message_id: messageId ?? null,
        uploaded_by: userId,
        storage_path: storagePath,
        file_name: file.name,
        mime_type: file.type || null,
      })
      .select()
      .single();
    if (error) throw error;

    await activityData.log({
      entity_type: "ticket",
      entity_id: ticketId,
      action: "evidence_added",
      metadata: { file_name: file.name },
    });

    return data;
  },

  getSignedUrl(storagePath: string) {
    return supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrl(storagePath, 3600);
  },
};

export const evidenceData = {
  async listForFinding(findingId: string): Promise<Evidence[]> {
    const { data, error } = await supabase
      .from("evidence")
      .select("*")
      .eq("finding_id", findingId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  },

  async uploadFile(findingId: string | null, ticketId: string | null, file: File) {
    const userId = await requireUserId();
    const prefix = findingId ? `finding-${findingId}` : `ticket-${ticketId}`;
    const storagePath = `${prefix}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from(EVIDENCE_BUCKET)
      .upload(storagePath, file);
    if (uploadError) throw uploadError;

    const { data, error } = await supabase
      .from("evidence")
      .insert({
        finding_id: findingId,
        ticket_id: ticketId,
        type: file.type.startsWith("image/") ? "image" : "file",
        name: file.name,
        source: "dashboard",
        storage_path: storagePath,
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  getSignedUrl(storagePath: string) {
    return supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(storagePath, 3600);
  },
};

export const retestData = {
  async listForFinding(findingId: string): Promise<RetestRun[]> {
    const { data, error } = await supabase
      .from("retest_runs")
      .select("*")
      .eq("finding_id", findingId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  },

  async listForTicket(ticketId: string): Promise<RetestRun[]> {
    const { data, error } = await supabase
      .from("retest_runs")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  },

  async requestRetest(ticketId: string, findingId: string): Promise<RetestRun> {
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from("retest_runs")
      .insert({
        ticket_id: ticketId,
        finding_id: findingId,
        requested_by: userId,
        status: "queued",
      })
      .select()
      .single();
    if (error) throw error;

    await ticketData.updateStatus(ticketId, "retest_requested");
    await activityData.log({
      entity_type: "ticket",
      entity_id: ticketId,
      action: "retest_requested",
    });
    return data;
  },

  async markRunning(id: string, externalTestRunId: string): Promise<RetestRun> {
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from("retest_runs")
      .update({
        status: "running",
        executed_by: userId,
        external_test_run_id: externalTestRunId,
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async complete(id: string, result: string, status: "completed" | "failed") {
    const { data, error } = await supabase
      .from("retest_runs")
      .update({ status, result, completed_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};

export interface DashboardMetrics {
  findingCounts: Record<FindingStatus, number>;
  criticalFindings: number;
  highFindings: number;
  ticketCounts: Record<TicketStatus, number>;
  openRemediation: number;
  riskAcceptancePending: number;
  acceptedRisks: number;
  retestPending: number;
  applicationsCount: number;
  assessmentsCount: number;
  assessmentsRunning: number;
}

export const metricsData = {
  async getOverview(): Promise<DashboardMetrics> {
    const { data: rpcData, error: rpcError } = await supabase.rpc("dashboard_metrics");
    if (!rpcError && rpcData) return rpcData as DashboardMetrics;

    const [findingsRes, ticketsRes, appsRes, assessmentsRes] = await Promise.all([
      supabase.from("findings").select("status,severity"),
      supabase.from("tickets").select("type,status"),
      supabase.from("applications").select("*", { count: "exact", head: true }),
      supabase.from("assessments").select("status"),
    ]);
    if (findingsRes.error) throw findingsRes.error;
    if (ticketsRes.error) throw ticketsRes.error;
    if (appsRes.error) throw appsRes.error;
    if (assessmentsRes.error) throw assessmentsRes.error;

    const findingCounts: Record<FindingStatus, number> = {
      at_risk: 0,
      reduced_risk: 0,
      inconclusive: 0,
    };
    let criticalFindings = 0;
    let highFindings = 0;
    for (const f of findingsRes.data) {
      findingCounts[f.status as FindingStatus] =
        (findingCounts[f.status as FindingStatus] ?? 0) + 1;
      if (f.severity === "critical") criticalFindings += 1;
      if (f.severity === "high") highFindings += 1;
    }

    const ticketCounts = {
      open: 0,
      in_progress: 0,
      fix_submitted: 0,
      retest_requested: 0,
      retest_in_progress: 0,
      under_review: 0,
      accepted: 0,
      rejected: 0,
      closed: 0,
    } as Record<TicketStatus, number>;
    for (const t of ticketsRes.data) {
      ticketCounts[t.status as TicketStatus] =
        (ticketCounts[t.status as TicketStatus] ?? 0) + 1;
    }

    type TicketCountRow = { type: TicketType; status: TicketStatus };
    const openRemediation = ticketsRes.data.filter(
      (t: TicketCountRow) =>
        t.type === "remediation" && !["closed", "accepted", "rejected"].includes(t.status),
    ).length;
    const riskAcceptancePending = ticketsRes.data.filter(
      (t: TicketCountRow) => t.type === "risk_acceptance" && t.status === "under_review",
    ).length;
    const acceptedRisks = ticketsRes.data.filter(
      (t: TicketCountRow) => t.type === "risk_acceptance" && t.status === "accepted",
    ).length;
    const retestPending = ticketsRes.data.filter((t: TicketCountRow) =>
      ["retest_requested", "retest_in_progress"].includes(t.status),
    ).length;

    return {
      findingCounts,
      criticalFindings,
      highFindings,
      ticketCounts,
      openRemediation,
      riskAcceptancePending,
      acceptedRisks,
      retestPending,
      applicationsCount: appsRes.count ?? 0,
      assessmentsCount: assessmentsRes.data.length,
      assessmentsRunning: assessmentsRes.data.filter(
        (a: { status: AssessmentStatus }) => a.status === "running",
      ).length,
    };
  },
};

export const riskAcceptanceData = {
  async getForTicket(ticketId: string): Promise<RiskAcceptance | null> {
    const { data, error } = await supabase
      .from("risk_acceptance")
      .select("*")
      .eq("ticket_id", ticketId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async listPending(): Promise<RiskAcceptance[]> {
    const { data, error } = await supabase
      .from("risk_acceptance")
      .select("*")
      .eq("decision", "pending")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  },

  async review(
    id: string,
    decision: RiskAcceptanceDecision,
    comment?: string,
  ): Promise<RiskAcceptance> {
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
    if (error) throw error;

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
