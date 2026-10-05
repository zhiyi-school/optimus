/**
 * Dev-server plugin that appends the browser's redacted debug lines to a local log file.
 */

import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";

export const DEBUG_LOG_ENDPOINT = "/__debug-log";
export const DEFAULT_DEBUG_LOG_FILE = "logs/dashboard-debug.log";
export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_LINE_LENGTH = 4000;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Collapses control characters, newlines included, so one entry stays one line, and caps its length. */
export function sanitizeLine(line: string): string {
  // eslint-disable-next-line no-control-regex
  return line.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, MAX_LINE_LENGTH);
}

/** Returns the lines of a `{ lines: string[] }` body, or null when the body has any other shape. */
export function parseDebugLines(body: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const lines = (parsed as { lines?: unknown } | null)?.lines;
  if (!Array.isArray(lines) || !lines.every((line) => typeof line === "string")) return null;
  return lines;
}

/** Appends the lines to the file, first moving a file past the size limit aside to `<file>.1`. */
export async function appendDebugLines(file: string, lines: string[]): Promise<void> {
  if (lines.length === 0) return;
  await mkdir(path.dirname(file), { recursive: true });
  const size = await stat(file).then((info) => info.size, () => 0);
  if (size >= MAX_FILE_BYTES) await rename(file, `${file}.1`);
  await appendFile(file, lines.map((line) => `${sanitizeLine(line)}\n`).join(""));
}

/** Reads a request body as text, resolving null once it exceeds the byte limit. */
function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Handles one request to the debug-log endpoint, answering 204, 400, 405, 413 or 500. */
export async function handleDebugLogRequest(req: IncomingMessage, res: ServerResponse, file: string): Promise<void> {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end();
    return;
  }
  const body = await readBody(req, MAX_BODY_BYTES);
  if (body === null) {
    res.statusCode = 413;
    res.end();
    return;
  }
  const lines = parseDebugLines(body);
  if (lines === null) {
    res.statusCode = 400;
    res.end();
    return;
  }
  try {
    await appendDebugLines(file, lines);
    res.statusCode = 204;
  } catch {
    res.statusCode = 500;
  }
  res.end();
}

/** Serves the debug-log endpoint during `npm run dev` only, writing to `file` under the project root. */
export function debugLogPlugin(file = DEFAULT_DEBUG_LOG_FILE): Plugin {
  return {
    name: "optimus-debug-log",
    apply: "serve",
    configureServer(server) {
      const target = path.resolve(server.config.root, file);
      server.middlewares.use(DEBUG_LOG_ENDPOINT, (req, res) => {
        void handleDebugLogRequest(req, res, target);
      });
    },
  };
}
