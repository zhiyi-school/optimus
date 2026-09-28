const STORAGE_KEY = "optimus:debug";
const SENSITIVE_KEY =
  /token|passw(?:or)?d|pwd|(?:^|[-_])pass(?:$|[-_])|secret|credential|private[-_]?key|authorization|cookie|api[-_]?key|anon[-_]?key|signed[-_]?url/i;
const REDACTED = "[redacted]";

export type DebugLogger = (message: string, ...details: unknown[]) => void;

/** True when `VITE_DEBUG=true` or `localStorage["optimus:debug"] === "1"`. */
export function isDebugEnabled(): boolean {
  if (import.meta.env.VITE_DEBUG === "true") return true;
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (value instanceof Error || value instanceof Blob) return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : redact(item, depth + 1),
    ]),
  );
}

/** Status, code and message only; Postgres `details` can echo row values. */
export function errorSummary(err: unknown) {
  const { status, code, message } = (err ?? {}) as {
    status?: number;
    code?: string;
    message?: string;
  };
  return { status, code, message: message ?? String(err) };
}

export function createDebug(scope: string): DebugLogger {
  return (message, ...details) => {
    if (!isDebugEnabled()) return;
    console.debug(`[${scope}] ${message}`, ...details.map((detail) => redact(detail)));
  };
}
