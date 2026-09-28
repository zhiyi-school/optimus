import { configApi, conflictingAppId, describeAutomationError, isBackendUnavailable, provisioningApi, testApi } from "@/api/automation-services";
import type { AppProvisioning, AutomationPlatform, RegisterAppRequest, RiskDefinition } from "@/api/automation-types";
import type { Application, Assessment, Ticket } from "@/data/types";
import { activityData } from "@/data/services/activity";
import { applicationData } from "@/data/services/applications";
import { assessmentData } from "@/data/services/assessments";
import { ticketData } from "@/data/services/tickets";
import { createDebug, errorSummary } from "@/lib/debug";
import { UserFacingError } from "@/lib/utils";

const debug = createDebug("data:sync:provisioning");

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
        "3. Drop the .ipa file into artifacts/intake/ios/ipas/ on the automation host.\n\n" +
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

export async function addApp(input: {
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
    debug("adding app", {
      name: input.name,
      platform: input.platform,
      hasIdentifier: !!input.identifier?.trim(),
      hasVersion: !!input.version?.trim(),
      contactEmails: input.contactEmails?.length ?? 0,
    });
    const existing = await applicationData.findByNameAndPlatform(input.name, input.platform);
    debug("existing application lookup", { found: !!existing, applicationId: existing?.id });
    if (existing && (await assessmentData.findForApplication(existing.id))) {
      debug("app already has an assessment; refusing duplicate", { applicationId: existing.id });
      throw new UserFacingError(
        `"${input.name}" already exists for ${input.platform === "ios" ? "iOS" : "Android"} — open that assessment instead of adding it again.`,
      );
    }

    const identifier = input.identifier?.trim();
    if (input.platform === "android" && !identifier) {
      debug("android app missing package name; refusing");
      throw new UserFacingError("A package name is required to register an Android app for testing.");
    }

    const risks = await testApi.listRisks(input.platform);
    debug("loaded platform risks", { platform: input.platform, count: risks.length });

    let backendAppId: string | null = null;
    let backendAppFreshlyRegistered = false;
    try {
      const registered = await provisioningApi.registerApp(
        input.platform,
        buildRegisterAppRequest(input, risks),
      );
      backendAppId = registered.id;
      backendAppFreshlyRegistered = true;
      debug("registered app with backend", { backendAppId });
    } catch (err) {
      debug("backend registration failed", { platform: input.platform, ...errorSummary(err) });
      backendAppId = conflictingAppId(err);
      if (backendAppId) debug("backend reported conflicting app; adopting it", { backendAppId });
      if (!backendAppId && (err as { status?: number } | null)?.status === 409) {
        debug("duplicate without app id; searching configured apps", { platform: input.platform });
        const existingApps = await configApi.listApps(input.platform).catch((listErr) => {
          debug("listing configured apps failed; using none", errorSummary(listErr));
          return [];
        });
        const match = existingApps.find((a) =>
          input.platform === "android" ? a.package_name === identifier : a.name === input.name,
        );
        backendAppId = match?.id ?? null;
        debug("configured app match", { candidates: existingApps.length, backendAppId });
        if (!backendAppId) {
          console.warn("Backend reported a duplicate app but did not say which.", err);
        }
      }
      if (!backendAppId && !isBackendUnavailable(err)) {
        debug("backend rejected app; aborting", { status: (err as { status?: number })?.status });
        console.error("Automation backend rejected the app:", describeAutomationError(err), err);
        throw new UserFacingError(
          "The automation backend could not register this app. Check the automation server logs for details.",
        );
      } else if (!backendAppId) {
        debug("backend unavailable; continuing without backend app");
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
      debug("provisioning state", {
        backendAppId,
        known: !!provisioningInfo,
        status: provisioningStatus,
        needsProvisioningTicket,
      });
    } else {
      debug("no backend app; skipping provisioning lookup");
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
        debug("rolling back backend app", { backendAppId });
        await provisioningApi
          .deleteApp(input.platform, backendAppId)
          .catch((err) => {
            debug("backend app rollback failed", { backendAppId, ...errorSummary(err) });
            console.warn(`Could not roll back backend app ${backendAppId}.`, err);
          });
      } else {
        debug("no freshly registered backend app to roll back", { backendAppId });
      }
    }

    let application: Application;
    debug(existing ? "updating application row" : "creating application row", {
      applicationId: existing?.id,
      externalId: backendAppId,
    });
    try {
      application = existing
        ? await applicationData.update(existing.id, applicationFields)
        : await applicationData.create(applicationFields);
      debug("saved application row", { applicationId: application.id });
    } catch (err) {
      debug("saving application row failed; rolling back", errorSummary(err));
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
      debug("created assessment", { assessmentId: assessment.id, totalTests: risks.length });
    } catch (err) {
      debug("creating assessment failed; rolling back", {
        applicationId: application.id,
        ...errorSummary(err),
      });
      if (!existing) {
        debug("removing newly created application row", { applicationId: application.id });
        await applicationData
          .remove(application.id, application.name)
          .catch((cleanupErr) => {
            debug("application row rollback failed", {
              applicationId: application.id,
              ...errorSummary(cleanupErr),
            });
            console.warn("Could not roll back application row.", cleanupErr);
          });
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
      debug("created provisioning ticket", { ticketId: ticket.id });
    } else {
      debug("provisioning ticket not needed");
    }

    debug("added app", {
      applicationId: application.id,
      assessmentId: assessment.id,
      ticketId: ticket?.id ?? null,
    });
    return { application, assessment, ticket };
  }
