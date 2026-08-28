import axios, { type AxiosInstance } from "axios";

const baseURL = import.meta.env.VITE_API_BASE_URL as string | undefined;

if (!baseURL) {
  console.warn(
    "VITE_API_BASE_URL is not set. The automation API client will not be able to reach the backend.",
  );
}

export const automationClient: AxiosInstance = axios.create({
  baseURL: baseURL ?? "",
  timeout: 30_000,
});

/** Absolute URL for an asset the backend serves under its own base path. */
export function automationAssetUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${(baseURL ?? "").replace(/\/$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
}

export class AutomationApiError extends Error {
  status: number | undefined;
  detail: unknown;

  constructor(message: string, status?: number, detail?: unknown) {
    super(message);
    this.name = "AutomationApiError";
    this.status = status;
    this.detail = detail;
  }
}

automationClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const detail = error.response?.data?.detail ?? error.response?.data;
      const message =
        typeof detail === "string"
          ? detail
          : error.message || "Automation API request failed.";
      return Promise.reject(new AutomationApiError(message, status, detail));
    }
    return Promise.reject(error);
  },
);
