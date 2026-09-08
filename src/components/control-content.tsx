import { useState, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, Circle, Download, ExternalLink } from "lucide-react";
import { EmptyState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { PlaybookContent } from "@/components/playbook-content";
import { playbookApi } from "@/api/playbook-services";
import { introRepeatsSummary } from "@/lib/resolve";
import { errorMessage, formatBytes } from "@/lib/utils";
import type { AutomationPlatform } from "@/api/automation-types";
import type { ControlDetail, ControlSourceMetadata, ControlStep } from "@/api/playbook-types";
import type { ControlProgressStatus, TicketControlStep } from "@/data/types";

export interface ControlStepProgress {
  byStepKey: Map<string, TicketControlStep>;
  /** Completed steps whose content changed while this page was open. */
  needsReview?: Set<string>;
  editable: boolean;
  pending: boolean;
  error: unknown;
  setStatus: (stepId: string, status: ControlProgressStatus, note?: string) => void;
}

export function ControlIntro({ control }: { control: ControlDetail }) {
  if (introRepeatsSummary(control)) return null;
  return <PlaybookContent blocks={control.intro} />;
}


export function ControlStepsEmpty() {
  return (
    <EmptyState
      title="This control has no remediation steps yet"
      description="The playbook document exists but does not list numbered steps. Ask security to complete it."
    />
  );
}

export function ControlReferences({ control }: { control: ControlDetail }) {
  if (control.references.length === 0) return null;
  return (
    <ul className="space-y-1">
      {control.references.map((reference) => (
        <li key={reference.url}>
          <a
            href={reference.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 rounded text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            <span className="break-all">{reference.label}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function ControlSourceArchive({
  platform,
  controlId,
  source,
}: {
  platform: AutomationPlatform | undefined;
  controlId: string | undefined;
  source: ControlSourceMetadata | null | undefined;
}) {
  if (!source?.exists || !platform || !controlId) return null;
  return (
    <div>
      <p className="mb-3 text-xs text-muted-foreground">
        A reference project with this control already implemented. It is an example to read, not
        evidence of your own fix.
      </p>
      {source.download_enabled ? (
        <a
          href={playbookApi.sourceDownloadUrl(platform, controlId)}
          className="inline-flex items-center gap-1.5 rounded text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Download className="h-3.5 w-3.5" />
          {source.file_name}
          {source.size_bytes ? ` (${formatBytes(source.size_bytes)})` : ""}
        </a>
      ) : (
        <p className="text-xs text-muted-foreground">
          {source.file_name} — downloads are disabled on this automation host.
        </p>
      )}
    </div>
  );
}

export function ControlGuidance({ notes }: { notes: (string | false | null | undefined)[] }) {
  const visible = notes.filter((note): note is string => !!note);
  if (visible.length === 0) return null;
  return (
    <div className="space-y-1">
      {visible.map((note) => (
        <p key={note}>{note}</p>
      ))}
    </div>
  );
}

function SupportingSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group rounded-md border border-border/70 bg-muted/40 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md px-3 py-2 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        {title}
        <ChevronDown
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-t border-border/70 p-3">{children}</div>
    </details>
  );
}

/** Whole-control reference material, folded under the active step rather than stacked beside it. */
export function ControlSupportingInfo({
  control,
  platform,
  controlId,
  source,
  children,
}: {
  control: ControlDetail;
  platform: AutomationPlatform | undefined;
  controlId: string | undefined;
  source: ControlSourceMetadata | null | undefined;
  children?: ReactNode;
}) {
  const hasIntro = !introRepeatsSummary(control);
  const hasReferences = control.references.length > 0;
  const hasSource = !!source?.exists && !!platform && !!controlId;
  if (!hasIntro && !hasReferences && !hasSource && !children) return null;

  return (
    <div data-guided-supporting className="space-y-2 border-t border-border pt-4">
      {children}
      {hasIntro && (
        <SupportingSection title="About this control">
          <ControlIntro control={control} />
        </SupportingSection>
      )}
      {hasReferences && (
        <SupportingSection title="References">
          <ControlReferences control={control} />
        </SupportingSection>
      )}
      {hasSource && (
        <SupportingSection title="Implementation example">
          <ControlSourceArchive platform={platform} controlId={controlId} source={source} />
        </SupportingSection>
      )}
    </div>
  );
}

export function ControlStepBody({
  step,
  index,
  progress,
}: {
  step: ControlStep;
  index: number;
  progress?: ControlStepProgress;
}) {
  const row = progress?.byStepKey.get(step.step_key);
  const [note, setNote] = useState(row?.developer_note ?? "");
  const [noteOpen, setNoteOpen] = useState(false);

  const number = step.number ?? index + 1;
  const done = row?.status === "completed";
  const changed = progress?.needsReview?.has(step.step_key) === true;
  const Icon = done ? CheckCircle2 : Circle;
  const editable = progress?.editable === true && row !== undefined;

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-foreground">
        {step.step_title ? `${number}. ${step.step_title}` : `Step ${number}`}
      </h2>

      {changed && (
        <p className="text-xs text-warning">
          This step changed after you completed it. Re-read it before asking for a reassessment.
        </p>
      )}

      {step.text && <p className="text-sm leading-relaxed text-foreground">{step.text}</p>}
      <PlaybookContent blocks={step.content} />

      <div className="space-y-2 border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!editable || progress?.pending}
            aria-pressed={done}
            aria-label={done ? `Mark step ${number} not started` : `Mark step ${number} complete`}
            onClick={() => row && progress?.setStatus(row.id, done ? "not_started" : "completed")}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon className={done ? "h-4 w-4 text-success" : "h-4 w-4 text-muted-foreground"} />
            {done ? "Completed" : "Mark complete"}
          </button>
          {progress?.pending && <span className="text-xs text-muted-foreground">Saving…</span>}
          {editable && row && !noteOpen && (
            <button
              type="button"
              className="rounded text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              onClick={() => setNoteOpen(true)}
            >
              {row.developer_note ? "Edit note" : "Add a note"}
            </button>
          )}
        </div>

        {progress?.error != null && (
          <p className="text-xs text-danger">
            {errorMessage(progress.error, "Could not save your progress.")}
          </p>
        )}

        {editable && row && progress && noteOpen && (
          <div className="space-y-2">
            <Textarea
              rows={2}
              value={note}
              aria-label={`Note for step ${number}`}
              placeholder="A note for security about this step…"
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={progress.pending}
                onClick={() => {
                  progress.setStatus(row.id, row.status, note);
                  setNoteOpen(false);
                }}
              >
                Save note
              </Button>
              <Button size="sm" variant="outline" onClick={() => setNoteOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {editable && row && !noteOpen && row.developer_note && (
          <p className="text-xs text-muted-foreground">{row.developer_note}</p>
        )}
      </div>
    </div>
  );
}

