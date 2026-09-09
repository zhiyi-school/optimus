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
    case "reassessment_active_running":
      return "Security has already started verifying this remediation.";
    case "reassessment_active_queued":
      return "A reassessment has been requested. Security runs it from this conversation.";
    case "reassessment_no_remediation":
      return "Start a remediation for this risk and complete its steps, then ask for a reassessment here.";
    case "reassessment_withdrawn":
      return "This remediation was withdrawn. Resume it to work on the risk again.";
    case "reassessment_security_finalised":
      return "Security has finished with this remediation.";
    case "reassessment_security_owned":
      return "Security is already verifying this remediation.";
    case "reassessment_wrong_state":
      return "This remediation is not in a state a reassessment can be asked for.";
    case "reassessment_loading":
      return "Loading the remediation approach…";
    case "reassessment_load_failed":
      return "The remediation approach could not be loaded, so completion cannot be checked.";
    case "reassessment_replaced":
      return "The approach this remediation was following is no longer in the playbook. Review the replacement first.";
    case "reassessment_no_approach":
      return "Choose a remediation approach and complete its steps first.";
    case "reassessment_reconciling":
      return "Preparing this approach's steps…";
    case "reassessment_no_steps":
      return "This approach has no steps to complete yet.";
    case "reassessment_incomplete":
      return `Complete all ${block.total} steps of the selected approach first — ${block.completed} done.`;
  }
}
