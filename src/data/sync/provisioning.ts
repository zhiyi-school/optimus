import { configApi, conflictingAppId, describeAutomationError, isBackendUnavailable, provisioningApi, testApi } from "@/api/automation-services";
import type { AppProvisioning, AutomationPlatform, RegisterAppRequest, RiskDefinition } from "@/api/automation-types";
import type { Application, Assessment, Ticket } from "@/data/types";
import { activityData, applicationData, assessmentData, ticketData } from "@/data/services";
import { UserFacingError } from "@/lib/utils";

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
  }
