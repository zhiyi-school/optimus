import { automationAssetUrl, automationClient } from "@/api/automation-client";
import { isBackendUnavailable } from "@/api/automation-services";
import type { AutomationPlatform } from "@/api/automation-types";
import type {
  ControlDetail,
  ControlSourceMetadata,
  PlaybookStatus,
} from "@/api/playbook-types";

const encode = encodeURIComponent;

export const playbookApi = {
  async listRiskControls(
    platform: AutomationPlatform,
    riskId: string,
  ): Promise<ControlDetail[]> {
    const { data } = await automationClient.get(
      `/platforms/${encode(platform)}/risks/${encode(riskId)}/controls`,
    );
    return data;
  },

  async getControl(platform: AutomationPlatform, controlId: string): Promise<ControlDetail> {
    const { data } = await automationClient.get(
      `/platforms/${encode(platform)}/controls/${encode(controlId)}`,
    );
    return data;
  },

  async getControlSource(
    platform: AutomationPlatform,
    controlId: string,
  ): Promise<ControlSourceMetadata | null> {
    try {
      const { data } = await automationClient.get(
        `/platforms/${encode(platform)}/controls/${encode(controlId)}/source`,
      );
      return data;
    } catch (err) {
      if (isBackendUnavailable(err)) return null;
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
    try {
      const { data } = await automationClient.get(`/platforms/${encode(platform)}/playbook/status`);
      return data;
    } catch (err) {
      if (isBackendUnavailable(err)) return null;
      throw err;
    }
  },

  async reload(platform: AutomationPlatform): Promise<PlaybookStatus> {
    const { data } = await automationClient.post(`/platforms/${encode(platform)}/playbook/reload`);
    return data;
  },
};
