import { automationAssetUrl, automationClient } from "@/api/automation-client";
import type {
  AppConfigEntry,
  AppProvisioning,
  AutomationPlatform,
  AutomationResultRow,
  DashboardSyncWorkerStatus,
  FeatureDefinition,
  RegisterAppRequest,
  RiskDefinition,
  RiskReportDetail,
  RunRecord,
  RunSyncStatus,
  SarifDocument,
  StartRunRequest,
} from "@/api/automation-types";
import { createDebug, errorSummary } from "@/lib/debug";

const debug = createDebug("api:automation");

export function defaultConfigPath(platform: AutomationPlatform): string {
  return `configs/${platform}.yaml`;
}

export const testApi = {
  async listRisks(platform: AutomationPlatform): Promise<RiskDefinition[]> {
    debug("listing risks", { platform });
    const { data } = await automationClient.get(`/platforms/${platform}/risks`);
    debug("listed risks", { platform, count: data?.length });
    return data;
  },

  async listFeatures(platform: AutomationPlatform): Promise<FeatureDefinition[]> {
    debug("listing features", { platform });
    const { data } = await automationClient.get(`/platforms/${platform}/features`);
    debug("listed features", { platform, count: data?.length });
    return data;
  },
};

export const configApi = {
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

function asApiError(err: unknown): ApiErrorShape | null {
  if (!err || typeof err !== "object") return null;
  const candidate = err as ApiErrorShape;
  return "status" in candidate || "detail" in candidate ? candidate : null;
}

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

export function conflictingAppId(err: unknown): string | null {
  const apiError = asApiError(err);
  if (apiError?.status !== 409) return null;
  return (apiError.detail as { app_id?: string } | null)?.app_id ?? null;
}

export function isBackendUnavailable(err: unknown): boolean {
  const apiError = asApiError(err);
  if (!apiError) return false;
  const { status } = apiError;
  return status === undefined || status === 404 || status === 405 || status === 501;
}

export const provisioningApi = {
  async registerApp(
    platform: AutomationPlatform,
    body: RegisterAppRequest,
  ): Promise<{ id: string }> {
    debug("registering app", { platform, fields: Object.keys(body) });
    const { data } = await automationClient.post(`/config/${platform}/apps`, body);
    debug("registered app", { platform, appId: data?.id });
    return data;
  },

  async getApp(
    platform: AutomationPlatform,
    appId: string,
  ): Promise<AppConfigEntry | null> {
    debug("fetching app config", { platform, appId });
    try {
      const { data } = await automationClient.get(`/config/${platform}/apps/${appId}`);
      debug("fetched app config", { platform, appId, found: data != null });
      return data;
    } catch (err) {
      debug("fetching app config failed", { platform, appId, ...errorSummary(err) });
      if (isBackendUnavailable(err)) {
        debug("app config unavailable; returning null", { platform, appId });
        return null;
      }
      throw err;
    }
  },

  async deleteApp(platform: AutomationPlatform, appId: string): Promise<void> {
    debug("deleting app config", { platform, appId });
    await automationClient.delete(`/config/${platform}/apps/${appId}`);
    debug("deleted app config", { platform, appId });
  },

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
  async listRuns(): Promise<RunRecord[]> {
    debug("listing runs");
    const { data } = await automationClient.get("/runs");
    debug("listed runs", { count: data?.length });
    return data;
  },

  async getRun(runId: string): Promise<RunRecord> {
    debug("fetching run", { runId });
    const { data } = await automationClient.get(`/runs/${encodeURIComponent(runId)}`);
    debug("fetched run", { runId, status: data?.status });
    return data;
  },

  async startRun(payload: StartRunRequest): Promise<RunRecord> {
    debug("starting run", { fields: Object.keys(payload) });
    const { data } = await automationClient.post("/runs", payload);
    debug("started run", { runId: data?.run_id, status: data?.status });
    return data;
  },

  async getRunSummary(runId: string): Promise<AutomationResultRow[]> {
    debug("fetching run summary", { runId });
    const { data } = await automationClient.get(`/runs/${encodeURIComponent(runId)}/summary`);
    debug("fetched run summary", { runId, rows: data?.length });
    return data;
  },

  async listReports(status?: string): Promise<string[]> {
    debug("listing reports", { status: status ?? null });
    const { data } = await automationClient.get("/reports", {
      params: status ? { status } : undefined,
    });
    debug("listed reports", { status: status ?? null, count: data?.length });
    return data;
  },

  async getReportSummary(runTimestamp: string): Promise<AutomationResultRow[]> {
    debug("fetching report summary", { runTimestamp });
    const { data } = await automationClient.get(
      `/reports/${encodeURIComponent(runTimestamp)}/summary`,
    );
    debug("fetched report summary", { runTimestamp, rows: data?.length });
    return data;
  },

  async getResultDetail(
    runTimestamp: string,
    reportPath: string,
  ): Promise<RiskReportDetail> {
    debug("fetching result detail", { runTimestamp, reportPath });
    const { data } = await automationClient.get(
      `/reports/${encodeURIComponent(runTimestamp)}/files/${reportPath}/report.json`,
    );
    debug("fetched result detail", { runTimestamp, reportPath, found: data != null });
    return data;
  },

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

  reportFileUrl(runTimestamp: string, filePath: string): string {
    const base = automationClient.defaults.baseURL ?? "";
    return `${base}/reports/${encodeURIComponent(runTimestamp)}/files/${filePath}`;
  },

  evidenceFileUrl(runTimestamp: string, ref: string): string {
    const base = automationClient.defaults.baseURL ?? "";
    const params = new URLSearchParams({ ref });
    return `${base}/reports/${encodeURIComponent(runTimestamp)}/evidence-file?${params}`;
  },

  eventsUrl(runId: string): string {
    const base = automationClient.defaults.baseURL ?? "";
    return `${base}/runs/${encodeURIComponent(runId)}/events`;
  },

  reportSarifUrl(runTimestamp: string): string {
    const base = automationClient.defaults.baseURL ?? "";
    return `${base}/reports/${encodeURIComponent(runTimestamp)}/sarif`;
  },

  /** `null` when the run has no SARIF — an incomplete run, or a report predating the export. */
  async getReportSarif(runTimestamp: string): Promise<SarifDocument | null> {
    debug("fetching report SARIF", { runTimestamp });
    try {
      const { data } = await automationClient.get(
        `/reports/${encodeURIComponent(runTimestamp)}/sarif`,
      );
      debug("fetched report SARIF", { runTimestamp, runs: data?.runs?.length });
      return data;
    } catch (err) {
      debug("fetching report SARIF failed", { runTimestamp, ...errorSummary(err) });
      if (isBackendUnavailable(err)) {
        debug("SARIF unavailable; returning null", { runTimestamp });
        return null;
      }
      throw err;
    }
  },

  /** Fetched as bytes so the browser never has to parse the document to hand it over. */
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
  /** `null` when the backend keeps no record — a run predating sync status, or an older API. */
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

  async getWorkerStatus(): Promise<DashboardSyncWorkerStatus | null> {
    debug("fetching sync worker status");
    try {
      const { data } = await automationClient.get("/sync/status");
      debug("fetched sync worker status", { keys: data ? Object.keys(data) : [] });
      return data;
    } catch (err) {
      debug("fetching sync worker status failed", errorSummary(err));
      if (isBackendUnavailable(err)) {
        debug("sync worker status unavailable; returning null");
        return null;
      }
      throw err;
    }
  },

  async resyncRun(runId: string): Promise<RunSyncStatus> {
    debug("requesting run resync", { runId });
    const { data } = await automationClient.post(`/runs/${encodeURIComponent(runId)}/sync`);
    debug("requested run resync", { runId, status: data?.status });
    return data;
  },
};

export const healthApi = {
  async check(): Promise<boolean> {
    debug("checking backend health");
    try {
      const { data } = await automationClient.get("/health");
      debug("backend health", { status: data?.status });
      return data?.status === "ok";
    } catch (err) {
      debug("backend health check failed", errorSummary(err));
      return false;
    }
  },
};
