/**
 * Automation backend endpoints for risks, app config and provisioning, runs, reports and sync.
 */

import { automationAssetUrl, automationClient } from "@/api/automation-client";
import type {
  AppConfigEntry,
  AppProvisioning,
  AutomationPlatform,
  AutomationResultRow,
  RegisterAppRequest,
  RiskDefinition,
  RunRecord,
  RunSyncStatus,
  StartRunRequest,
} from "@/api/automation-types";
import { createDebug, errorSummary } from "@/lib/debug";

const debug = createDebug("api:automation");

/** Backend-relative path of a platform's default config file. */
export function defaultConfigPath(platform: AutomationPlatform): string {
  return `configs/${platform}.yaml`;
}

export const testApi = {
  /** Lists the risks the backend can test on a platform. */
  async listRisks(platform: AutomationPlatform): Promise<RiskDefinition[]> {
    debug("listing risks", { platform });
    const { data } = await automationClient.get(`/platforms/${platform}/risks`);
    debug("listed risks", { platform, count: data?.length });
    return data;
  },

};

export const configApi = {
  /** Lists the apps configured for a platform. */
  async listApps(platform: AutomationPlatform): Promise<AppConfigEntry[]> {
    debug("listing configured apps", { platform });
    const { data } = await automationClient.get(`/config/${platform}/apps`);
    debug("listed configured apps", { platform, count: data?.length });
    return data;
  },
};

interface ApiErrorShape {
  status?: number;
  detail?: unknown;
  message?: string;
}

/** Returns the value as an API error shape when it carries a status or detail, else null. */
function asApiError(err: unknown): ApiErrorShape | null {
  if (!err || typeof err !== "object") return null;
  const candidate = err as ApiErrorShape;
  return "status" in candidate || "detail" in candidate ? candidate : null;
}

/** Extracts a readable message from an automation API error or any thrown value. */
export function describeAutomationError(err: unknown): string {
  const apiError = asApiError(err);
  if (apiError) {
    const { detail } = apiError;
    if (Array.isArray(detail)) return detail.map((d) => String(d)).join("; ");
    if (typeof detail === "string") return detail;
    const message = (detail as { message?: string } | null)?.message;
    if (message) return message;
  }
  return err instanceof Error ? err.message : "Automation API request failed.";
}

/** The existing app id from a 409 conflict response, else null. */
export function conflictingAppId(err: unknown): string | null {
  const apiError = asApiError(err);
  if (apiError?.status !== 409) return null;
  return (apiError.detail as { app_id?: string } | null)?.app_id ?? null;
}

/** True when an error means the endpoint is unreachable or unsupported (no status, 404, 405, 501). */
export function isBackendUnavailable(err: unknown): boolean {
  const apiError = asApiError(err);
  if (!apiError) return false;
  const { status } = apiError;
  return status === undefined || status === 404 || status === 405 || status === 501;
}

export const provisioningApi = {
  /** Registers a new app in the platform's config and returns its id. */
  async registerApp(
    platform: AutomationPlatform,
    body: RegisterAppRequest,
  ): Promise<{ id: string }> {
    debug("registering app", { platform, fields: Object.keys(body) });
    const { data } = await automationClient.post(`/config/${platform}/apps`, body);
    debug("registered app", { platform, appId: data?.id });
    return data;
  },


  /** Removes an app from the platform's config. */
  async deleteApp(platform: AutomationPlatform, appId: string): Promise<void> {
    debug("deleting app config", { platform, appId });
    await automationClient.delete(`/config/${platform}/apps/${appId}`);
    debug("deleted app config", { platform, appId });
  },

  /** Fetches an app's provisioning status, or null when the endpoint is unavailable. */
  async getProvisioning(
    platform: AutomationPlatform,
    appId: string,
  ): Promise<AppProvisioning | null> {
    debug("fetching app provisioning", { platform, appId });
    try {
      const { data } = await automationClient.get(
        `/config/${platform}/apps/${appId}/provisioning`,
      );
      debug("fetched app provisioning", { platform, appId, found: data != null });
      return data;
    } catch (err) {
      debug("fetching app provisioning failed", { platform, appId, ...errorSummary(err) });
      if (isBackendUnavailable(err)) {
        debug("provisioning endpoint unavailable; returning null", { platform, appId });
        return null;
      }
      throw err;
    }
  },
};

export const iconApi = {
  /** The backend endpoint for an app's icon, versioned by build so a new one is never cached over. */
  url(platform: AutomationPlatform, appId: string, artifactSha256?: string): string {
    const path = `/config/${encodeURIComponent(platform)}/apps/${encodeURIComponent(appId)}/icon`;
    const url = automationAssetUrl(path);
    return artifactSha256 ? `${url}?v=${encodeURIComponent(artifactSha256)}` : url;
  },
};

export const assessmentApi = {
  /** Lists every automation run the backend knows. */
  async listRuns(): Promise<RunRecord[]> {
    debug("listing runs");
    const { data } = await automationClient.get("/runs");
    debug("listed runs", { count: data?.length });
    return data;
  },

  /** Fetches one run record. */
  async getRun(runId: string): Promise<RunRecord> {
    debug("fetching run", { runId });
    const { data } = await automationClient.get(`/runs/${encodeURIComponent(runId)}`);
    debug("fetched run", { runId, status: data?.status });
    return data;
  },

  /** Starts an automation run and returns its record. */
  async startRun(payload: StartRunRequest): Promise<RunRecord> {
    debug("starting run", { fields: Object.keys(payload) });
    const { data } = await automationClient.post("/runs", payload);
    debug("started run", { runId: data?.run_id, status: data?.status });
    return data;
  },


  /** Lists report timestamps, optionally filtered by status. */
  async listReports(status?: string): Promise<string[]> {
    debug("listing reports", { status: status ?? null });
    const { data } = await automationClient.get("/reports", {
      params: status ? { status } : undefined,
    });
    debug("listed reports", { status: status ?? null, count: data?.length });
    return data;
  },

  /** Fetches the result rows of a report. */
  async getReportSummary(runTimestamp: string): Promise<AutomationResultRow[]> {
    debug("fetching report summary", { runTimestamp });
    const { data } = await automationClient.get(
      `/reports/${encodeURIComponent(runTimestamp)}/summary`,
    );
    debug("fetched report summary", { runTimestamp, rows: data?.length });
    return data;
  },


  /** Fetches recent results for one app and risk, newest first up to `limit`. */
  async getTestHistory(
    appId: string,
    riskId: string,
    limit = 20,
  ): Promise<AutomationResultRow[]> {
    debug("fetching test history", { appId, riskId, limit });
    const { data } = await automationClient.get(
      `/apps/${encodeURIComponent(appId)}/risks/${encodeURIComponent(riskId)}/history`,
      { params: { limit } },
    );
    debug("fetched test history", { appId, riskId, rows: data?.length });
    return data;
  },


  /** URL that downloads an evidence file by its opaque ref. */
  evidenceFileUrl(runTimestamp: string, ref: string): string {
    const base = automationClient.defaults.baseURL ?? "";
    const params = new URLSearchParams({ ref });
    return `${base}/reports/${encodeURIComponent(runTimestamp)}/evidence-file?${params}`;
  },

  /** URL of a run's server-sent event stream. */
  eventsUrl(runId: string): string {
    const base = automationClient.defaults.baseURL ?? "";
    return `${base}/runs/${encodeURIComponent(runId)}/events`;
  },



  /** Downloads a report's SARIF as a Blob, so the browser never parses it; null when unavailable. */
  async downloadReportSarif(runTimestamp: string): Promise<Blob | null> {
    debug("downloading report SARIF", { runTimestamp });
    try {
      const { data } = await automationClient.get(
        `/reports/${encodeURIComponent(runTimestamp)}/sarif`,
        { responseType: "blob" },
      );
      debug("downloaded report SARIF", { runTimestamp, bytes: data?.size });
      return data;
    } catch (err) {
      debug("downloading report SARIF failed", { runTimestamp, ...errorSummary(err) });
      if (isBackendUnavailable(err)) {
        debug("SARIF download unavailable; returning null", { runTimestamp });
        return null;
      }
      throw err;
    }
  },
};

export const syncApi = {
  /** Fetches a run's dashboard sync status, or null when the backend keeps no record of it. */
  async getRunSyncStatus(runId: string): Promise<RunSyncStatus | null> {
    debug("fetching run sync status", { runId });
    try {
      const { data } = await automationClient.get(`/runs/${encodeURIComponent(runId)}/sync-status`);
      debug("fetched run sync status", { runId, status: data?.status });
      return data;
    } catch (err) {
      debug("fetching run sync status failed", { runId, ...errorSummary(err) });
      if (isBackendUnavailable(err)) {
        debug("sync status unavailable; returning null", { runId });
        return null;
      }
      throw err;
    }
  },

  /** Requests that a run's results be synced to the dashboard again. */
  async resyncRun(runId: string): Promise<RunSyncStatus> {
    debug("requesting run resync", { runId });
    const { data } = await automationClient.post(`/runs/${encodeURIComponent(runId)}/sync`);
    debug("requested run resync", { runId, status: data?.status });
    return data;
  },
};
