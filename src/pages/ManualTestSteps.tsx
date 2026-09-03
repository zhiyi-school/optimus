import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FileText, Info, X } from "lucide-react";
import type {
  DemonstrationBlock,
  DemonstrationImage,
  DemonstrationStep,
  DemonstrationStepsBlock,
  DemonstrationTableBlock,
} from "@/api/automation-types";
import { EmptyState, LoadingState } from "@/components/common";
import { PlaybookFigure } from "@/components/playbook-content";
import { RiskGoal } from "@/components/risk-goal";
import { renderInline } from "@/lib/inline-markdown";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <tbody>
            {block.rows.map((row, index) => (
              <tr key={index} className="border-b border-border/70 last:border-0">
                {columns.map((column, columnIndex) => (
                  <td
                    key={column}
                    className={
                      columnIndex === 0
                        ? "w-44 bg-muted/40 px-3 py-2 align-top font-medium text-foreground"
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

function Step({
  step,
  number,
  anchorId,
}: {
  step: DemonstrationStep;
  number: number;
  anchorId: string;
}) {
  return (
    <div id={anchorId} className="flex scroll-mt-6 gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
        {number}
      </div>
      <div className="min-w-0 flex-1 space-y-3 pb-6">
        <p className="text-sm text-foreground">{renderInline(step.text)}</p>
        {step.commands?.map((command, commandIndex) => (
          <pre
            key={commandIndex}
            className="overflow-x-auto rounded-lg bg-muted px-3 py-2 text-xs text-foreground"
          >
            <code>{command}</code>
          </pre>
        ))}
        {step.images?.map((image, imageIndex) => (
          <StepImage key={image.path || imageIndex} image={image} />
        ))}
      </div>
    </div>
  );
}

function Steps({ block, numbering }: { block: DemonstrationStepsBlock; numbering: StepAnchors }) {
  if (!block.items?.length) return null;
  return (
    <div>
      {block.label && (
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {block.label}
        </p>
      )}
      <div>
        {block.items.map((step, index) => {
          const entry = numbering.get(`${block.id}:${index}`);
          return (
            <Step
              key={entry?.anchorId ?? index}
              step={step}
              number={entry?.number ?? index + 1}
              anchorId={entry?.anchorId ?? `manual-step-${index + 1}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function Block({ block, numbering }: { block: DemonstrationBlock; numbering: StepAnchors }) {
  if (block.type === "table") return <SetupTable block={block} />;
  if (block.type === "steps") return <Steps block={block} numbering={numbering} />;
  return null;
}

interface StepAnchor {
  number: number;
  anchorId: string;
  label: string;
}

type StepAnchors = Map<string, StepAnchor>;

/** One running number across every steps block, anchored on the backend step id where there is one. */
function stepAnchors(blocks: DemonstrationBlock[]): { order: StepAnchor[]; byPosition: StepAnchors } {
  const order: StepAnchor[] = [];
  const byPosition: StepAnchors = new Map();
  let number = 0;
  blocks.forEach((block) => {
    if (block.type !== "steps") return;
    (block.items ?? []).forEach((_step, index) => {
      number += 1;
      const entry = { number, anchorId: `manual-step-${number}`, label: `Step ${number}` };
      order.push(entry);
      byPosition.set(`${block.id}:${index}`, entry);
    });
  });
  return { order, byPosition };
}

function StepNavigation({
  steps,
  activeAnchorId,
  onSelect,
}: {
  steps: StepAnchor[];
  activeAnchorId: string | null;
  onSelect: (anchorId: string) => void;
}) {
  if (steps.length === 0) return null;
  return (
    <nav aria-label="Manual testing steps" className="lg:sticky lg:top-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Steps
      </p>
      <ul className="flex max-h-[60vh] gap-2 overflow-x-auto overflow-y-hidden pb-2 [scrollbar-gutter:stable] lg:max-h-[calc(100vh-12rem)] lg:flex-col lg:gap-1 lg:overflow-x-hidden lg:overflow-y-auto lg:pb-0 lg:pr-3">
        {steps.map((step) => {
          const active = step.anchorId === activeAnchorId;
          return (
            <li key={step.anchorId} className="shrink-0 lg:shrink">
              <a
                href={`#${step.anchorId}`}
                aria-current={active ? "step" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  onSelect(step.anchorId);
                }}
                className={cn(
                  "block min-h-[2.25rem] rounded-md px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  active
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {step.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
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
  const { order, byPosition } = useMemo(() => stepAnchors(blocks), [blocks]);
  const [chosenAnchorId, setChosenAnchorId] = useState<string | null>(null);
  const activeAnchorId =
    chosenAnchorId && order.some((step) => step.anchorId === chosenAnchorId)
      ? chosenAnchorId
      : (order[0]?.anchorId ?? null);

  useEffect(() => {
    if (order.length === 0 || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setChosenAnchorId(visible.target.id);
      },
      { rootMargin: "-10% 0px -70% 0px" },
    );
    for (const step of order) {
      const element = document.getElementById(step.anchorId);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [order]);

  function goToStep(anchorId: string) {
    setChosenAnchorId(anchorId);
    const element = document.getElementById(anchorId);
    element?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  if (isLoading) return <LoadingState label="Loading…" />;

  return (
    <Card>
      <CardContent className="py-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <FileText className="h-4.5 w-4.5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">
                Manual Testing Steps{risk ? `: ${risk.name}` : ""}
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Follow these steps to manually verify this risk.
              </p>
            </div>
          </div>
          <Link
            to={`/assessments/${assessmentId}/tests/${testId}`}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </Link>
        </div>

        {risk?.goal && (
          <div className="mb-6 flex items-start gap-2 rounded-lg bg-primary/5 p-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <RiskGoal risk={risk} />
          </div>
        )}

        {blocks.length === 0 ? (
          <EmptyState title="Manual steps for this test haven't been written yet." />
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
            <StepNavigation
              steps={order}
              activeAnchorId={activeAnchorId}
              onSelect={goToStep}
            />
            <div className="min-w-0 space-y-6">
              {blocks.map((block, index) => (
                <Block key={block.id || index} block={block} numbering={byPosition} />
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end border-t border-border/70 pt-4">
          <Link to={`/assessments/${assessmentId}/tests/${testId}`}>
            <Button variant="outline">Back to test</Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
