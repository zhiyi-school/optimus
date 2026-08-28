import { automationClient } from "@/api/automation-client";
import type {
  AppConfigEntry,
  AppProvisioning,
  AutomationPlatform,
  AutomationResultRow,
  FeatureDefinition,
  RegisterAppRequest,
  RiskDefinition,
  RiskReportDetail,
  RunRecord,
  StartRunRequest,
} from "@/api/automation-types";

export function defaultConfigPath(platform: AutomationPlatform): string {
  return `configs/${platform}.yaml`;
}

export const testApi = {
  async listRisks(platform: AutomationPlatform): Promise<RiskDefinition[]> {
    const { data } = await automationClient.get(`/platforms/${platform}/risks`);
    return data;
  },

  async listFeatures(platform: AutomationPlatform): Promise<FeatureDefinition[]> {
    const { data } = await automationClient.get(`/platforms/${platform}/features`);
    return data;
  },
};

export const configApi = {
  async listApps(platform: AutomationPlatform): Promise<AppConfigEntry[]> {
    const { data } = await automationClient.get(`/config/${platform}/apps`);
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
    const { data } = await automationClient.post(`/config/${platform}/apps`, body);
    return data;
  },

  async getApp(
    platform: AutomationPlatform,
    appId: string,
  ): Promise<AppConfigEntry | null> {
    try {
      const { data } = await automationClient.get(`/config/${platform}/apps/${appId}`);
      return data;
    } catch (err) {
      if (isBackendUnavailable(err)) return null;
      throw err;
    }
  },

  async deleteApp(platform: AutomationPlatform, appId: string): Promise<void> {
    await automationClient.delete(`/config/${platform}/apps/${appId}`);
  },

  async getProvisioning(
    platform: AutomationPlatform,
    appId: string,
  ): Promise<AppProvisioning | null> {
    try {
      const { data } = await automationClient.get(
        `/config/${platform}/apps/${appId}/provisioning`,
      );
      return data;
    } catch (err) {
      if (isBackendUnavailable(err)) return null;
      throw err;
    }
  },
};

export const assessmentApi = {
  async listRuns(): Promise<RunRecord[]> {
    const { data } = await automationClient.get("/runs");
    return data;
  },

  async getRun(runId: string): Promise<RunRecord> {
    const { data } = await automationClient.get(`/runs/${runId}`);
    return data;
  },

  async startRun(payload: StartRunRequest): Promise<RunRecord> {
    const { data } = await automationClient.post("/runs", payload);
    return data;
  },

  async getRunSummary(runId: string): Promise<AutomationResultRow[]> {
    const { data } = await automationClient.get(`/runs/${runId}/summary`);
    return data;
  },

  async listReports(): Promise<string[]> {
    const { data } = await automationClient.get("/reports");
    return data;
  },

  async getReportSummary(runTimestamp: string): Promise<AutomationResultRow[]> {
    const { data } = await automationClient.get(
      `/reports/${encodeURIComponent(runTimestamp)}/summary`,
    );
    return data;
  },

  async getResultDetail(
    runTimestamp: string,
    reportPath: string,
  ): Promise<RiskReportDetail> {
    const { data } = await automationClient.get(
      `/reports/${encodeURIComponent(runTimestamp)}/files/${reportPath}/report.json`,
    );
    return data;
  },

  async getTestHistory(
    appId: string,
    riskId: string,
    limit = 20,
  ): Promise<AutomationResultRow[]> {
    const { data } = await automationClient.get(
      `/apps/${encodeURIComponent(appId)}/risks/${encodeURIComponent(riskId)}/history`,
      { params: { limit } },
    );
    return data;
  },

  reportFileUrl(runTimestamp: string, filePath: string): string {
    const base = automationClient.defaults.baseURL ?? "";
    return `${base}/reports/${encodeURIComponent(runTimestamp)}/files/${filePath}`;
  },

  evidenceFileUrl(runTimestamp: string, filePath: string): string {
    const base = automationClient.defaults.baseURL ?? "";
    const params = new URLSearchParams({ path: filePath });
    return `${base}/reports/${encodeURIComponent(runTimestamp)}/evidence-file?${params}`;
  },

  eventsUrl(runId: string): string {
    const base = automationClient.defaults.baseURL ?? "";
    return `${base}/runs/${runId}/events`;
  },
};

export const healthApi = {
  async check(): Promise<boolean> {
    try {
      const { data } = await automationClient.get("/health");
      return data?.status === "ok";
    } catch {
      return false;
    }
  },
};
