import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { FileText } from "lucide-react";
import type {
  DemonstrationBlock,
  DemonstrationContentBlock,
  DemonstrationImage,
  DemonstrationStep,
  DemonstrationTableBlock,
  RiskDefinition,
} from "@/api/automation-types";
import { EmptyState, LoadingState } from "@/components/common";
import { CodeBlock } from "@/components/code-block";
import { PlaybookFigure, PlaybookGallery } from "@/components/playbook-content";
import { EstimatedTime, GuidedSteps, type GuidedStep } from "@/components/guided-steps";
import { renderInline } from "@/lib/inline-markdown";
import { stepCountLabel } from "@/lib/utils";
import { useAssessment } from "@/hooks/queries/assessments";
import { useRiskCatalogue } from "@/hooks/queries/automation";

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

function StepContent({ block }: { block: DemonstrationContentBlock }) {
  switch (block.type) {
    case "paragraph":
      return <p className="text-sm leading-relaxed text-foreground">{renderInline(block.text)}</p>;
    case "caption":
      return <p className="text-xs italic text-muted-foreground">{renderInline(block.text)}</p>;
    case "heading":
      return <h3 className="text-sm font-semibold text-foreground">{renderInline(block.text)}</h3>;
    case "code":
      return <CodeBlock code={block.text} language={block.language ?? undefined} />;
    case "image":
      return (
        <PlaybookGallery>
          <StepImage image={block} />
        </PlaybookGallery>
      );
    case "list":
      return (
        <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-foreground">
          {block.items.map((item, index) => (
            <li key={index}>{renderInline(item.text)}</li>
          ))}
        </ul>
      );
    case "table":
      return <SetupTable block={{ id: "", type: "table", rows: block.rows ?? [] }} />;
    default:
      return null;
  }
}

function StepBody({ step, number }: { step: DemonstrationStep; number: number }) {
  const ordered = step.content ?? [];
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-foreground">
        {step.title?.trim() ? `${number}. ${step.title.trim()}` : `Step ${number}`}
      </h2>
      <p className="text-sm leading-relaxed text-foreground">{renderInline(step.text)}</p>
      {ordered.length > 0 ? (
        ordered.map((block, index) => <StepContent key={index} block={block} />)
      ) : (
        <>
          {step.commands?.map((command, commandIndex) => (
            <CodeBlock key={commandIndex} code={command} language="shell" />
          ))}
          {step.images && step.images.length > 0 && (
            <PlaybookGallery>
              {step.images.map((image, imageIndex) => (
                <StepImage key={image.path || imageIndex} image={image} />
              ))}
            </PlaybookGallery>
          )}
        </>
      )}
    </div>
  );
}

function RiskTactic({ risk }: { risk: RiskDefinition | undefined }) {
  if (!risk?.tactic) return null;
  return (
    <p className="text-sm text-foreground">
      <span className="font-semibold">MITRE ATT&amp;CK Tactic:</span> {risk.tactic}
      {risk.tactic_id ? ` (${risk.tactic_id})` : ""}
    </p>
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
    label: step.step.title?.trim() || `Step ${step.number}`,
  }));

  return (
    <GuidedSteps
      icon={FileText}
      title={`Manual Testing Steps${risk ? ` — ${risk.name}` : ""}`}
      description={steps.length > 0 ? "Follow these steps to manually verify this risk." : undefined}
      tip={steps.length > 0 && risk?.tactic ? <RiskTactic risk={risk} /> : undefined}
      steps={navSteps}
      activeId={activeId}
      onSelect={setChosenId}
      aside={<EstimatedTime value={stepCountLabel(steps.length)} />}
      closeTo={backTo}
      closeLabel="Back to test"
      navLabel="Manual testing steps"
      finishLabel="Done"
    >
      {isLoading ? (
        <LoadingState label="Loading…" />
      ) : steps.length === 0 ? (
        <EmptyState title="Manual steps for this test haven't been written yet." />
      ) : (
        <div className="space-y-4">
          {active && <StepBody step={active.step} number={active.number} />}
          {activeIndex === 0 &&
            tables.map((table, index) => <SetupTable key={table.id || index} block={table} />)}
        </div>
      )}
    </GuidedSteps>
  );
}
