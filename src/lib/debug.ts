/**
 * Opt-in, redacting debug logging to the console and, under the dev server, a log file; see docs/setup.md#debug-logging.
 */

const STORAGE_KEY = "optimus:debug";
/** Served by vite-plugins/debug-log.ts during `npm run dev`; the two must name the same path. */
export const DEBUG_LOG_ENDPOINT = "/__debug-log";
const FILE_FLUSH_DELAY_MS = 1000;
export const MAX_PENDING_FILE_LINES = 500;
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

/** Deep-copies a value with sensitive-looking keys replaced, up to five levels deep. */
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

/** Reduces an error to status, code and message, since Postgres `details` can echo row values. */
export function errorSummary(err: unknown) {
  const { status, code, message } = (err ?? {}) as {
    status?: number;
    code?: string;
    message?: string;
  };
  return { status, code, message: message ?? String(err) };
}

/** Renders one detail as JSON, keeping errors readable and falling back to text for values JSON cannot hold. */
function serializeDetail(detail: unknown): string {
  try {
    const json = JSON.stringify(detail, (_key, value: unknown) => {
      if (value instanceof Error) return { name: value.name, message: value.message };
      if (value instanceof Blob) return `[Blob ${value.size} bytes]`;
      if (typeof value === "bigint") return value.toString();
      return value;
    });
    return json ?? String(detail);
  } catch {
    return String(detail);
  }
}

/** Formats one already-redacted debug entry as a single timestamped line for the log file. */
export function formatDebugLine(scope: string, message: string, details: unknown[], now = new Date()): string {
  const rendered = details.map(serializeDetail).join(" ");
  return `${now.toISOString()} [${scope}] ${message}${rendered ? ` ${rendered}` : ""}`;
}

export interface DebugFileSink {
  write: (line: string) => void;
  flush: () => void;
}

/** Buffers log-file lines and hands them to `send` in batches, keeping at most 500 waiting and noting any dropped. */
export function createDebugFileSink(
  send: (lines: string[]) => void,
  schedule: (flush: () => void) => void = (flush) => setTimeout(flush, FILE_FLUSH_DELAY_MS),
): DebugFileSink {
  let pending: string[] = [];
  let dropped = 0;
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    if (pending.length === 0 && dropped === 0) return;
    const lines = dropped > 0 ? [...pending, `${dropped} debug line(s) dropped before they could be written`] : pending;
    pending = [];
    dropped = 0;
    send(lines);
  };
  return {
    write(line) {
      if (pending.length >= MAX_PENDING_FILE_LINES) dropped += 1;
      else pending.push(line);
      if (scheduled) return;
      scheduled = true;
      schedule(flush);
    },
    flush,
  };
}

/** Posts a batch to the dev server's debug-log endpoint, ignoring failures so logging never breaks the page. */
function postDebugLines(lines: string[]) {
  void fetch(DEBUG_LOG_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lines }),
    keepalive: true,
  }).catch(() => {});
}

let fileSink: DebugFileSink | null | undefined;

/** Returns the log-file sink under the dev server, or null in production builds and tests. */
function devFileSink(): DebugFileSink | null {
  if (fileSink !== undefined) return fileSink;
  if (!import.meta.env.DEV || import.meta.env.MODE === "test" || typeof fetch !== "function") {
    fileSink = null;
    return fileSink;
  }
  const sink = createDebugFileSink(postDebugLines);
  globalThis.addEventListener?.("pagehide", () => sink.flush());
  fileSink = sink;
  return fileSink;
}

/** Returns a logger that writes redacted `console.debug` lines under a scope, and to the dev log file, when debugging is enabled. */
export function createDebug(scope: string): DebugLogger {
  return (message, ...details) => {
    if (!isDebugEnabled()) return;
    const redacted = details.map((detail) => redact(detail));
    console.debug(`[${scope}] ${message}`, ...redacted);
    devFileSink()?.write(formatDebugLine(scope, message, redacted));
  };
}
