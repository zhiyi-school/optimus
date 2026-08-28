import { supabase } from "@/data/supabase";
import {
  assessmentApi,
  configApi,
  conflictingAppId,
  defaultConfigPath,
  describeAutomationError,
  isBackendUnavailable,
  provisioningApi,
  testApi,
} from "@/api/automation-services";
import type {
  AppProvisioning,
  AutomationPlatform,
  AutomationResultRow,
  RegisterAppRequest,
  RiskDefinition,
  RiskVerdict,
  RunRecord,
  StartRunRequest,
} from "@/api/automation-types";
import type { Application, Assessment, FindingStatus, Ticket } from "@/data/types";
import { applicationData, assessmentData, activityData, ticketData } from "@/data/services";
import { UserFacingError } from "@/lib/utils";

const RUN_POLL_INTERVAL_MS = 3000;
const RUN_POLL_MAX_ATTEMPTS = 120;

export interface RunCancelToken {
  cancelled: boolean;
}

export function mapVerdictToFindingStatus(verdict: RiskVerdict | string): FindingStatus {
  switch (verdict) {
    case "At Risk":
      return "at_risk";
    case "Reduced Risk":
      return "reduced_risk";
    case "Inconclusive":
    default:
      return "inconclusive";
  }
}

async function upsertFindingFromResult(
  row: AutomationResultRow,
  verdict: RiskVerdict,
  applicationId: string,
  assessmentId: string,
  triggeredBy: string | null,
) {
  const externalId = `${row.app_id}::${row.test_id}`;
  const newStatus = mapVerdictToFindingStatus(verdict);

  const { data: existing, error: fetchError } = await supabase
    .from("findings")
    .select("*")
    .eq("external_id", externalId)
    .maybeSingle();
  if (fetchError) throw fetchError;

  const basePayload = {
    external_id: externalId,
    application_id: applicationId,
    assessment_id: assessmentId,
    test_id: row.test_id,
    latest_test_run_id: row.run_timestamp,
    title: row.test_name,
    description: row.summary,
    severity: row.severity,
    platform: row.platform,
    updated_at: new Date().toISOString(),
  };

  if (!existing) {
    const { data: created, error } = await supabase
      .from("findings")
      .insert({ ...basePayload, status: newStatus })
      .select()
      .single();
    if (error) throw error;

    await supabase.from("finding_history").insert({
      finding_id: created.id,
      previous_status: null,
      new_status: newStatus,
      changed_by: triggeredBy,
      reason: "Automation result synced",
    });
    await activityData.log({
      entity_type: "finding",
      entity_id: created.id,
      action: "finding_created",
      metadata: { test_id: row.test_id, run_timestamp: row.run_timestamp },
    });
    return created;
  }

  const statusChanged = existing.status !== newStatus;
  const { data: updated, error } = await supabase
    .from("findings")
    .update({ ...basePayload, status: newStatus })
    .eq("id", existing.id)
    .select()
    .single();
  if (error) throw error;

  if (statusChanged) {
    await supabase.from("finding_history").insert({
      finding_id: existing.id,
      previous_status: existing.status,
      new_status: newStatus,
      changed_by: triggeredBy,
      reason: "Automation result synced",
    });
    await activityData.log({
      entity_type: "finding",
      entity_id: existing.id,
      action: "finding_status_changed",
      metadata: {
        previous_status: existing.status,
        new_status: newStatus,
        run_timestamp: row.run_timestamp,
      },
    });
  }

  return updated;
}

function provisioningTicketCopy(
  platform: AutomationPlatform,
  appName: string,
  identifier: string | undefined,
) {
  if (platform === "ios") {
    return {
      title: `Provision app for testing: ${appName}`,
      description:
        `1. Install "${appName}" from the App Store onto the test device, under the test Apple ID.\n` +
        "2. Extract the IPA from the device.\n" +
        "3. Drop the .ipa file into intake/ios/ipas/ on the automation host.\n\n" +
        "The backend matches the build to this app by name and marks setup complete on its own — " +
        "no config change needed, now or for future versions.",
    };
  }
  return {
    title: `Provision app for testing: ${appName}`,
    description:
      `Install "${appName}"${identifier ? ` (${identifier})` : ""} onto the Android test device. ` +
      "The dashboard checks the device directly and marks setup complete once it's there.",
  };
}

function buildRegisterAppRequest(
  input: { name: string; platform: AutomationPlatform; version?: string; identifier?: string },
  risks: RiskDefinition[],
): RegisterAppRequest {
  const body: RegisterAppRequest = {
    name: input.name,
    risks: Object.fromEntries(risks.map((r) => [r.risk_id, { enabled: true }])),
  };
  if (input.version?.trim()) body.version = input.version.trim();

  if (input.platform === "android") {
    body.package_name = input.identifier?.trim();
    return body;
  }

  body.artifact = { source: "intake_ipa" };
  return body;
}

export const syncService = {
  async addApp(input: {
    name: string;
    platform: AutomationPlatform;
    version?: string;
    identifier?: string;
    appType?: string;
    contactEmails?: string[];
    ownerName?: string;
    ownerEmail?: string;
    developerContactName?: string;
    developerContactEmail?: string;
  }): Promise<{ application: Application; assessment: Assessment; ticket: Ticket | null }> {
    const existing = await applicationData.findByNameAndPlatform(input.name, input.platform);
    if (existing && (await assessmentData.findForApplication(existing.id))) {
      throw new UserFacingError(
        `"${input.name}" already exists for ${input.platform === "ios" ? "iOS" : "Android"} — open that assessment instead of adding it again.`,
      );
    }

    const identifier = input.identifier?.trim();
    if (input.platform === "android" && !identifier) {
      throw new UserFacingError("A package name is required to register an Android app for testing.");
    }

    const risks = await testApi.listRisks(input.platform);

    let backendAppId: string | null = null;
    let backendAppFreshlyRegistered = false;
    try {
      const registered = await provisioningApi.registerApp(
        input.platform,
        buildRegisterAppRequest(input, risks),
      );
      backendAppId = registered.id;
      backendAppFreshlyRegistered = true;
    } catch (err) {
      backendAppId = conflictingAppId(err);
      if (!backendAppId && (err as { status?: number } | null)?.status === 409) {
        const existingApps = await configApi.listApps(input.platform).catch(() => []);
        const match = existingApps.find((a) =>
          input.platform === "android" ? a.package_name === identifier : a.name === input.name,
        );
        backendAppId = match?.id ?? null;
        if (!backendAppId) {
          console.warn("Backend reported a duplicate app but did not say which.", err);
        }
      }
      if (!backendAppId && !isBackendUnavailable(err)) {
        console.error("Automation backend rejected the app:", describeAutomationError(err), err);
        throw new UserFacingError(
          "The automation backend could not register this app. Check the automation server logs for details.",
        );
      } else if (!backendAppId) {
        console.warn("Could not register app with the automation backend.", err);
      }
    }

    let provisioningStatus: Application["provisioning_status"] = backendAppId ? "pending" : null;
    let needsProvisioningTicket = !!backendAppId;
    let provisioningInfo: AppProvisioning | null = null;
    if (backendAppId) {
      provisioningInfo = await provisioningApi.getProvisioning(input.platform, backendAppId);
      if (provisioningInfo) {
        provisioningStatus = provisioningInfo.status;
        needsProvisioningTicket = provisioningInfo.status !== "ready";
      }
    }

    const applicationFields = {
      name: input.name,
      platform: input.platform,
      external_id: backendAppId,
      provisioning_status: provisioningStatus,
      version: input.version || null,
      identifier: provisioningInfo?.bundle_id ?? input.identifier ?? null,
      app_type: input.appType || null,
      contact_emails: input.contactEmails ?? [],
      owner_name: input.ownerName || null,
      owner_email: input.ownerEmail || null,
      developer_contact_name: input.developerContactName || null,
      developer_contact_email: input.developerContactEmail || null,
    };

    async function rollback() {
      if (backendAppId && backendAppFreshlyRegistered) {
        await provisioningApi
          .deleteApp(input.platform, backendAppId)
          .catch((err) => console.warn(`Could not roll back backend app ${backendAppId}.`, err));
      }
    }

    let application: Application;
    try {
      application = existing
        ? await applicationData.update(existing.id, applicationFields)
        : await applicationData.create(applicationFields);
    } catch (err) {
      await rollback();
      throw err;
    }

    let assessment: Assessment;
    try {
      assessment = await assessmentData.create({
        external_id: `manual::${application.id}`,
        application_id: application.id,
        status: "queued",
        total_tests: risks.length,
        completed_tests: 0,
      });
    } catch (err) {
      if (!existing) {
        await applicationData
          .remove(application.id, application.name)
          .catch((cleanupErr) => console.warn("Could not roll back application row.", cleanupErr));
      }
      await rollback();
      throw err;
    }

    await activityData.log({
      entity_type: "assessment",
      entity_id: assessment.id,
      action: "assessment_created",
      metadata: { application_id: application.id },
    });

    let ticket: Ticket | null = null;
    if (needsProvisioningTicket) {
      const copy = provisioningTicketCopy(
        input.platform,
        application.name,
        application.identifier ?? undefined,
      );
      ticket = await ticketData.createAppProvisioningTicket({
        application_id: application.id,
        title: copy.title,
        description: copy.description,
      });
    }

    return { application, assessment, ticket };
  },

  async runAllTests(input: {
    assessmentId: string;
    platform: AutomationPlatform;
    appExternalId: string;
    riskIds?: string[];
    triggeredBy?: string | null;
  }): Promise<boolean> {
    const claimed = await assessmentData.claimForRun(input.assessmentId);
    if (!claimed) return false;

    try {
      const { run, synced } = await syncService.runAndSync(
        {
          platform: input.platform,
          config_path: defaultConfigPath(input.platform),
          apps: input.appExternalId,
          ...(input.riskIds?.length ? { risks: input.riskIds.join(",") } : {}),
        },
        input.triggeredBy ?? null,
      );
      if (!synced && run.status === "failed") {
        await assessmentData.setStatus(input.assessmentId, "failed");
      }
      return true;
    } catch (err) {
      const busy = (err as { status?: number } | null)?.status === 409;
      await assessmentData
        .setStatus(input.assessmentId, busy ? "queued" : "failed")
        .catch((releaseErr) => console.warn("Could not release the assessment claim.", releaseErr));
      throw err;
    }
  },

  async syncReport(runTimestamp: string, triggeredBy: string | null = null) {
    const rows = await assessmentApi.getReportSummary(runTimestamp);
    if (rows.length === 0) return { applications: 0, findings: 0 };

    const byApp = new Map<string, AutomationResultRow[]>();
    for (const row of rows) {
      const bucket = byApp.get(row.app_id) ?? [];
      bucket.push(row);
      byApp.set(row.app_id, bucket);
    }

    const catalogueCache = new Map<string, number>();
    let findingCount = 0;

    for (const [appId, appRows] of byApp) {
      const first = appRows[0];

      const unlinked = await applicationData.findUnlinkedByNameAndPlatform(
        first.app_name,
        first.platform,
      );
      const application = unlinked
        ? await applicationData.update(unlinked.id, {
            external_id: appId,
            identifier: first.package_or_bundle_id,
            provisioning_status: "ready",
            provisioning_error: null,
            updated_at: new Date().toISOString(),
          })
        : await applicationData.upsertByExternalId({
            external_id: appId,
            name: first.app_name,
            platform: first.platform,
            identifier: first.package_or_bundle_id,
            updated_at: new Date().toISOString(),
          });

      if (!catalogueCache.has(first.platform)) {
        const risks = await testApi.listRisks(first.platform);
        catalogueCache.set(first.platform, risks.length);
      }
      const totalTests = catalogueCache.get(first.platform) ?? appRows.length;
      const distinctTestIds = new Set(appRows.map((r) => r.test_id));

      const runKey = `${runTimestamp}::${appId}`;
      const assessmentFields = {
        application_id: application.id,
        status: "completed" as const,
        total_tests: totalTests,
        completed_tests: distinctTestIds.size,
        updated_at: new Date().toISOString(),
      };
      const alreadySynced = await assessmentData.findByExternalId(runKey);
      let assessment: Assessment;
      if (alreadySynced) {
        assessment = await assessmentData.update(alreadySynced.id, assessmentFields);
      } else {
        const placeholder = await assessmentData.findPlaceholderForApplication(application.id);
        try {
          assessment = placeholder
            ? await assessmentData.update(placeholder.id, { ...assessmentFields, external_id: runKey })
            : await assessmentData.upsertByExternalId({ ...assessmentFields, external_id: runKey });
        } catch (err) {
          console.warn(`Falling back to upsert for run ${runKey}.`, err);
          assessment = await assessmentData.upsertByExternalId({ ...assessmentFields, external_id: runKey });
        }
      }

      for (let i = 0; i < appRows.length; i += 1) {
        await upsertFindingFromResult(
          appRows[i],
          appRows[i].verdict ?? "Inconclusive",
          application.id,
          assessment.id,
          triggeredBy,
        );
        findingCount += 1;
      }
    }

    return { applications: byApp.size, findings: findingCount };
  },

  async runAndSync(
    payload: StartRunRequest,
    triggeredBy: string | null = null,
    onStarted?: (run: RunRecord) => unknown,
    cancelToken?: RunCancelToken,
  ): Promise<{ run: RunRecord; synced: boolean; cancelled: boolean }> {
    const started = await assessmentApi.startRun(payload);
    if (onStarted) await onStarted(started);

    let latest = started;
    let attempts = 0;

    while (latest.status === "running" && attempts < RUN_POLL_MAX_ATTEMPTS) {
      if (cancelToken?.cancelled) {
        return { run: latest, synced: false, cancelled: true };
      }
      await new Promise((resolve) => setTimeout(resolve, RUN_POLL_INTERVAL_MS));
      latest = await assessmentApi.getRun(started.run_id);
      attempts += 1;
    }

    if (latest.status === "completed") {
      await syncService.syncReport(latest.run_timestamp, triggeredBy);
      return { run: latest, synced: true, cancelled: false };
    }

    return { run: latest, synced: false, cancelled: false };
  },
};
