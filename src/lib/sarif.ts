import type { RunRecord } from "@/api/automation-types";

/** Only a completed run has the manifest the backend requires before it will export. */
export function canExportSarif(
  run: Pick<RunRecord, "status" | "run_timestamp"> | null | undefined,
): boolean {
  return !!run && run.status === "completed" && !!run.run_timestamp;
}

export function sarifFileName(runTimestamp: string): string {
  const safe = runTimestamp.replace(/[^A-Za-z0-9._-]/g, "_") || "run";
  return `${safe}.sarif`;
}
