import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { RiskDefinition } from "@/api/automation-types";

function withBoldTactic(goal: string, tactic: string | null | undefined): ReactNode {
  if (!tactic) return goal;
  const at = goal.toLowerCase().indexOf(tactic.toLowerCase());
  if (at === -1) return goal;
  return (
    <>
      {goal.slice(0, at)}
      <strong className="font-semibold">{goal.slice(at, at + tactic.length)}</strong>
      {goal.slice(at + tactic.length)}
    </>
  );
}

export function RiskGoal({
  risk,
  className,
}: {
  risk: Pick<RiskDefinition, "goal" | "tactic"> | undefined | null;
  className?: string;
}) {
  if (!risk?.goal) return null;
  return (
    <p className={cn("text-sm text-foreground", className)}>
      <span className="font-semibold">Goal:</span> {withBoldTactic(risk.goal, risk.tactic)}
    </p>
  );
}
