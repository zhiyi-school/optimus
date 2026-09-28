import axios, { type AxiosInstance } from "axios";
import { createDebug } from "@/lib/debug";

const debug = createDebug("api:automation");
const baseURL = import.meta.env.VITE_API_BASE_URL as string | undefined;
const requestStartedAt = new WeakMap<object, number>();

if (!baseURL) {
  console.warn(
    "VITE_API_BASE_URL is not set. The automation API client will not be able to reach the backend.",
  );
}

export const automationClient: AxiosInstance = axios.create({
  baseURL: baseURL ?? "",
  timeout: 30_000,
});

debug("client configured", {
  baseURL: baseURL ?? null,
  timeout: automationClient.defaults.timeout,
});

function summarizePayload(data: unknown): unknown {
  if (data === undefined || data === null) return data;
  if (Array.isArray(data)) return { items: data.length };
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return { blobBytes: data.size, type: data.type };
  }
  if (typeof data === "string") return { chars: data.length };
  if (typeof data === "object") return { keys: Object.keys(data).slice(0, 12) };
  return typeof data;
}

function elapsedMs(config: object | undefined): number | undefined {
  const startedAt = config ? requestStartedAt.get(config) : undefined;
  return startedAt === undefined ? undefined : Math.round(performance.now() - startedAt);
}

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

automationClient.interceptors.request.use((config) => {
  requestStartedAt.set(config, performance.now());
  debug("request", {
    method: config.method?.toUpperCase(),
    url: config.url,
    params: config.params,
    body: summarizePayload(config.data),
    responseType: config.responseType,
  });
  return config;
});

automationClient.interceptors.response.use(
  (response) => {
    debug("response", {
      method: response.config.method?.toUpperCase(),
      url: response.config.url,
      status: response.status,
      ms: elapsedMs(response.config),
      data: summarizePayload(response.data),
    });
    return response;
  },
  (error) => {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const detail = error.response?.data?.detail ?? error.response?.data;
      const message =
        typeof detail === "string"
          ? detail
          : error.message || "Automation API request failed.";
      debug("request failed", {
        method: error.config?.method?.toUpperCase(),
        url: error.config?.url,
        params: error.config?.params,
        status,
        code: error.code,
        ms: elapsedMs(error.config),
        message,
      });
      return Promise.reject(new AutomationApiError(message, status, detail));
    }
    debug("non-axios error in response pipeline", { message: error?.message });
    return Promise.reject(error);
  },
);
