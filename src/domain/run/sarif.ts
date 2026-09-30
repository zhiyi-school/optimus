/**
 * Decisions and naming for SARIF report exports.
 */

import type { RunRecord } from "@/automation-api/types";

/** True for a completed run with a timestamp, the only kind the backend will export as SARIF. */
export function canExportSarif(
  run: Pick<RunRecord, "status" | "run_timestamp"> | null | undefined,
): boolean {
  return !!run && run.status === "completed" && !!run.run_timestamp;
}

/** A filesystem-safe `.sarif` file name for a run timestamp. */
export function sarifFileName(runTimestamp: string): string {
  const safe = runTimestamp.replace(/[^A-Za-z0-9._-]/g, "_") || "run";
  return `${safe}.sarif`;
}
