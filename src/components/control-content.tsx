import { useState } from "react";
import { CheckCircle2, Circle, Download, ExternalLink } from "lucide-react";
import { EmptyState } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { PlaybookContent } from "@/components/playbook-content";
import { playbookApi } from "@/api/playbook-services";
import { errorMessage } from "@/lib/utils";
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
  if (control.intro.length === 0) return null;
  return (
    <Card className="mt-4">
      <CardContent className="py-4">
        <PlaybookContent blocks={control.intro} />
      </CardContent>
    </Card>
  );
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
    <Card className="mt-4">
      <CardContent className="py-4">
        <h2 className="mb-2 text-sm font-semibold text-foreground">References</h2>
        <ul className="space-y-1">
          {control.references.map((reference) => (
            <li key={reference.url}>
              <a
                href={reference.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                <span className="break-all">{reference.label}</span>
              </a>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
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
    <Card className="mt-4">
      <CardContent className="py-4">
        <h2 className="mb-1 text-sm font-semibold text-foreground">Implementation example</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          A reference project with this control already implemented. It is an example to read, not
          evidence of your own fix.
        </p>
        {source.download_enabled ? (
          <a
            href={playbookApi.sourceDownloadUrl(platform, controlId)}
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
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
      </CardContent>
    </Card>
  );
}

/** One step of a control, rendered on its own inside the guided-step shell. */
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

  const done = row?.status === "completed";
  const changed = progress?.needsReview?.has(step.step_key) === true;
  const Icon = done ? CheckCircle2 : Circle;
  const editable = progress?.editable === true && row !== undefined;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Step {step.number ?? index + 1}
          </p>
          <h2 className="text-sm font-semibold text-foreground">{step.step_title}</h2>
        </div>
        <button
          type="button"
          disabled={!editable || progress?.pending}
          aria-pressed={done}
          aria-label={done ? `Mark step ${index + 1} not started` : `Mark step ${index + 1} complete`}
          onClick={() => row && progress?.setStatus(row.id, done ? "not_started" : "completed")}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon className={done ? "h-4 w-4 text-success" : "h-4 w-4 text-muted-foreground"} />
          {done ? "Completed" : "Mark complete"}
        </button>
      </div>

      {changed && (
        <p className="text-xs text-warning">
          This step changed after you completed it. Re-read it before submitting your fix.
        </p>
      )}

      {step.text && <p className="text-sm text-foreground">{step.text}</p>}
      <PlaybookContent blocks={step.content} />

      {progress?.error != null && (
        <p className="text-xs text-danger">
          {errorMessage(progress.error, "Could not save your progress.")}
        </p>
      )}

      {editable && row && (
        <div className="border-t border-border/70 pt-3">
          {noteOpen ? (
            <div className="space-y-2">
              <Textarea
                rows={2}
                value={note}
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
          ) : (
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => setNoteOpen(true)}
            >
              {row.developer_note ? "Edit note" : "Add a note"}
            </button>
          )}
          {!noteOpen && row.developer_note && (
            <p className="mt-1 text-xs text-muted-foreground">{row.developer_note}</p>
          )}
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
