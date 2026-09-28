import { automationAssetUrl, automationClient } from "@/api/automation-client";
import { isBackendUnavailable } from "@/api/automation-services";
import type { AutomationPlatform } from "@/api/automation-types";
import type {
  ControlDetail,
  ControlSourceMetadata,
  PlaybookStatus,
} from "@/api/playbook-types";
import { createDebug, errorSummary } from "@/lib/debug";

const debug = createDebug("api:playbook");

const encode = encodeURIComponent;

export const playbookApi = {
  async listRiskControls(
    platform: AutomationPlatform,
    riskId: string,
  ): Promise<ControlDetail[]> {
    debug("listing risk controls", { platform, riskId });
    const { data } = await automationClient.get(
      `/platforms/${encode(platform)}/risks/${encode(riskId)}/controls`,
    );
    debug("listed risk controls", { platform, riskId, count: data?.length });
    return data;
  },

  async getControl(platform: AutomationPlatform, controlId: string): Promise<ControlDetail> {
    debug("fetching control", { platform, controlId });
    const { data } = await automationClient.get(
      `/platforms/${encode(platform)}/controls/${encode(controlId)}`,
    );
    debug("fetched control", { platform, controlId, steps: data?.steps?.length });
    return data;
  },

  async getControlSource(
    platform: AutomationPlatform,
    controlId: string,
  ): Promise<ControlSourceMetadata | null> {
    debug("fetching control source", { platform, controlId });
    try {
      const { data } = await automationClient.get(
        `/platforms/${encode(platform)}/controls/${encode(controlId)}/source`,
      );
      debug("fetched control source", { platform, controlId, found: data != null });
      return data;
    } catch (err) {
      debug("fetching control source failed", { platform, controlId, ...errorSummary(err) });
      if (isBackendUnavailable(err)) {
        debug("control source unavailable; returning null", { platform, controlId });
        return null;
      }
      throw err;
    }
  },

  sourceDownloadUrl(platform: AutomationPlatform, controlId: string): string {
    return automationAssetUrl(
      `/platforms/${encode(platform)}/controls/${encode(controlId)}/source/download`,
    );
  },

  /** `null` when the backend predates the playbook endpoints, so callers can degrade. */
  async getStatus(platform: AutomationPlatform): Promise<PlaybookStatus | null> {
    debug("fetching playbook status", { platform });
    try {
      const { data } = await automationClient.get(`/platforms/${encode(platform)}/playbook/status`);
      debug("fetched playbook status", {
        platform,
        readable: data?.readable,
        revision: data?.revision,
        risks: data?.risk_count,
        controls: data?.control_count,
        warnings: data?.warnings?.length,
      });
      return data;
    } catch (err) {
      debug("fetching playbook status failed", { platform, ...errorSummary(err) });
      if (isBackendUnavailable(err)) {
        debug("playbook endpoints unavailable; returning null", { platform });
        return null;
      }
      throw err;
    }
  },

  async reload(platform: AutomationPlatform): Promise<PlaybookStatus> {
    debug("reloading playbook", { platform });
    const { data } = await automationClient.post(`/platforms/${encode(platform)}/playbook/reload`);
    debug("reloaded playbook", { platform, revision: data?.revision, readable: data?.readable });
    return data;
  },
};
