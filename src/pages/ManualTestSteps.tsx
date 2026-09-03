import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { FileText } from "lucide-react";
import type {
  DemonstrationBlock,
  DemonstrationImage,
  DemonstrationStep,
  DemonstrationTableBlock,
} from "@/api/automation-types";
import { EmptyState, LoadingState } from "@/components/common";
import { PlaybookFigure, PlaybookGallery } from "@/components/playbook-content";
import { GuidedSteps, type GuidedStep } from "@/components/guided-steps";
import { RiskGoal } from "@/components/risk-goal";
import { renderInline } from "@/lib/inline-markdown";
import { useRiskCatalogue, useAssessment } from "@/hooks/queries";

function SetupTable({ block }: { block: DemonstrationTableBlock }) {
  const columns = useMemo(() => {
    const seen: string[] = [];
    for (const row of block.rows ?? []) {
      for (const key of Object.keys(row)) if (!seen.includes(key)) seen.push(key);
    }
    return seen;
  }, [block.rows]);

  if (!block.rows?.length) return null;

  return (
    <div>
      {block.label && (
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {block.label}
        </p>
      )}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <tbody>
            {block.rows.map((row, index) => (
              <tr key={index} className="border-b border-border/70 last:border-0">
                {columns.map((column, columnIndex) => (
                  <td
                    key={column}
                    className={
                      columnIndex === 0
                        ? "w-40 bg-muted/40 px-3 py-2 align-top font-medium text-foreground"
                        : "break-words px-3 py-2 align-top text-muted-foreground"
                    }
                  >
                    {renderInline(row[column]) ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StepImage({ image }: { image: DemonstrationImage }) {
  return (
    <PlaybookFigure
      url={image.url}
      caption={image.caption}
      alt="Reference screenshot"
      exists={image.exists}
      unavailableLabel="Reference screenshot unavailable."
    />
  );
}

function StepBody({ step, number }: { step: DemonstrationStep; number: number }) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Step {number}
      </p>
      <p className="text-sm text-foreground">{renderInline(step.text)}</p>
      {step.commands?.map((command, commandIndex) => (
        <pre
          key={commandIndex}
          className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs text-foreground"
        >
          <code>{command}</code>
        </pre>
      ))}
      {step.images && step.images.length > 0 && (
        <PlaybookGallery>
          {step.images.map((image, imageIndex) => (
            <StepImage key={image.path || imageIndex} image={image} />
          ))}
        </PlaybookGallery>
      )}
    </div>
  );
}

interface FlatStep {
  id: string;
  number: number;
  step: DemonstrationStep;
}

/** One running number across every steps block, keyed on the backend step id where there is one. */
function flattenSteps(blocks: DemonstrationBlock[]): FlatStep[] {
  const flat: FlatStep[] = [];
  blocks.forEach((block) => {
    if (block.type !== "steps") return;
    (block.items ?? []).forEach((step) => {
      const number = flat.length + 1;
      flat.push({ id: step.id ? `${block.id}:${step.id}` : `manual-step-${number}`, number, step });
    });
  });
  return flat;
}

export default function ManualTestSteps() {
  const { assessmentId, testId } = useParams<{ assessmentId: string; testId: string }>();
  const { data: assessment, isLoading } = useAssessment(assessmentId);
  const platform = assessment?.application?.platform;
  const { data: risks } = useRiskCatalogue(platform);
  const risk = useMemo(() => risks?.find((r) => r.risk_id === testId), [risks, testId]);
  const blocks = useMemo(
    () => (risk?.demonstration ?? []).filter((block) => block && typeof block === "object"),
    [risk],
  );
  const steps = useMemo(() => flattenSteps(blocks), [blocks]);
  const tables = useMemo(
    () => blocks.filter((block): block is DemonstrationTableBlock => block.type === "table"),
    [blocks],
  );

  const [chosenId, setChosenId] = useState<string | null>(null);
  const activeId =
    chosenId && steps.some((step) => step.id === chosenId)
      ? chosenId
      : (steps[0]?.id ?? null);
  const activeIndex = steps.findIndex((step) => step.id === activeId);
  const active = activeIndex >= 0 ? steps[activeIndex] : undefined;

  const backTo = `/assessments/${assessmentId}/tests/${testId}`;
  const navSteps: GuidedStep[] = steps.map((step) => ({
    id: step.id,
    label: `Step ${step.number}`,
  }));

  if (isLoading) return <LoadingState label="Loading…" />;

  if (steps.length === 0) {
    return <EmptyState title="Manual steps for this test haven't been written yet." />;
  }

  return (
    <GuidedSteps
      icon={FileText}
      title={`Manual Testing Steps${risk ? ` — ${risk.name}` : ""}`}
      description="Follow these steps to manually verify this risk."
      tip={risk?.goal ? <RiskGoal risk={risk} /> : undefined}
      steps={navSteps}
      activeId={activeId}
      onSelect={setChosenId}
      closeTo={backTo}
      closeLabel="Back to test"
      navLabel="Manual testing steps"
      finishLabel="Done"
    >
      <div className="space-y-4">
        {active && <StepBody step={active.step} number={active.number} />}
        {activeIndex === 0 &&
          tables.map((table, index) => <SetupTable key={table.id || index} block={table} />)}
      </div>
    </GuidedSteps>
  );
}
