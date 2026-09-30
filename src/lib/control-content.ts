/**
 * Summaries of a control's playbook content and detection of step content that changed after completion.
 */

import type { ControlDetail, ControlStep } from "@/automation-api/playbook-types";
import { createDebug } from "@/lib/debug";
import type { LiveStep } from "@/lib/resolve";

const debug = createDebug("lib:control-content");

/** Keys of completed steps whose content changed since the hashes were captured. */
export function changedSinceCompleted(
  live: LiveStep[],
  hashesAtLoad: Map<string, string> | undefined,
): Set<string> {
  const changed = new Set<string>();
  if (!hashesAtLoad) return changed;
  for (const entry of live) {
    const before = hashesAtLoad.get(entry.step.step_key);
    if (!before) continue;
    if (entry.row?.status === "completed" && before !== entry.step.content_hash) {
      changed.add(entry.step.step_key);
    }
  }
  if (changed.size > 0) debug("completed steps changed since load", { stepKeys: [...changed] });
  return changed;
}

/** Each step's content hash by step key. */
export function contentHashes(steps: ControlStep[]): Map<string, string> {
  return new Map(steps.map((step) => [step.step_key, step.content_hash]));
}

/** A control's summary when it adds something beyond the title. */
export function controlSummary(control: ControlDetail): string | undefined {
  const summary = (control.summary ?? "").trim();
  return summary && summary !== control.title.trim() ? summary : undefined;
}

/** True when a control's intro is empty or just its summary paragraph. */
export function introRepeatsSummary(control: ControlDetail): boolean {
  if (control.intro.length === 0) return true;
  if (control.intro.length > 1) return false;
  const [block] = control.intro;
  return block.type === "paragraph" && (block.text ?? "").trim() === (control.summary ?? "").trim();
}
