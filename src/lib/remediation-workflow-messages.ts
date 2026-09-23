import type { RemediationBlock } from "@/lib/remediation-workflow";

export function remediationBlockMessage(block: RemediationBlock | null): string | null {
  if (!block) return null;
  switch (block.code) {
    case "approach_permission":
      return "Only the developers assigned to this application can change the remediation approach.";
    case "approach_not_remediation":
      return "This is not a remediation ticket.";
    case "approach_withdrawn":
      return "This remediation was withdrawn. Resume it to change the approach.";
    case "approach_security_finalised":
      return "Security has finished with this remediation, so the approach is fixed.";
    case "approach_security_owned":
      return "Security is verifying this remediation, so the approach cannot be changed until that finishes.";
    case "reassessment_permission":
      return "Only the developers assigned to this application can ask for a reassessment.";
  }
}
