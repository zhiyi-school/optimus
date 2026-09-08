// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposerSubmission } from "@/hooks/conversation-composer";
import type { Finding, RetestRun, Ticket } from "@/data/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONVERSATION = "example-conversation-id";
const FINDING = "example-finding-id";
const TICKET = "example-ticket-id";

interface Call {
  name: string;
  input: unknown;
}

let calls: Call[] = [];
let uploads: { conversationId: string; entryId: string; fileName: string }[] = [];
let uploadFails = false;
let definitions: unknown[] = [];
let definitionsFailed = false;
let controlRows: unknown[] = [];
let stepRows: unknown[] = [];

const CONTROL = "example-feature-01-risk-01-control-01";

function approach(stepKeys = ["step-one"]) {
  return {
    control_id: CONTROL,
    status: "active",
    required: true,
    steps: stepKeys.map((key, index) => ({
      step_key: key,
      step_index: index,
      number: index + 1,
      content_hash: `sha256:${key}`,
      content: [],
    })),
  };
}

function completedRows(stepKeys = ["step-one"], status = "completed") {
  controlRows = [{ id: "tc-1", ticket_id: TICKET, control_id: CONTROL, status }];
  stepRows = stepKeys.map((key) => ({ id: `tc-1-${key}`, ticket_control_id: "tc-1", step_key: key, status }));
}

vi.mock("@/data/supabase", () => ({
  ATTACHMENTS_BUCKET: "ticket-attachments",
  EVIDENCE_BUCKET: "evidence",
  supabase: { from: () => ({}), auth: {}, storage: { from: () => ({}) } },
}));

vi.mock("@/data/services", () => ({
  riskConversationData: {
    uploadAttachment: (conversationId: string, entryId: string, file: File) => {
      if (uploadFails) return Promise.reject(new Error("Example storage failure."));
      uploads.push({ conversationId, entryId, fileName: file.name });
      return Promise.resolve({ id: "attachment-1" });
    },
  },
}));

vi.mock("@/hooks/queries", () => ({
  useRiskControls: () => ({ data: definitions, isLoading: false, isError: definitionsFailed }),
  useTicketControls: () => ({ data: controlRows, isLoading: false, isError: false }),
  useTicketControlSteps: () => ({ data: stepRows, isLoading: false, isError: false }),
  useSendRiskMessage: () => ({
    mutateAsync: (input: unknown) => {
      calls.push({ name: "message", input });
      return Promise.resolve({ id: "entry-message" });
    },
    isPending: false,
    error: null,
  }),
  useClassifyRisk: () => ({
    mutateAsync: (input: unknown) => {
      calls.push({ name: "classify", input });
      return Promise.resolve({ finding: { id: FINDING }, entryId: "entry-classification" });
    },
    isPending: false,
    error: null,
  }),
  useRequestReassessment: () => ({
    mutateAsync: (input: unknown) => {
      calls.push({ name: "reassessment", input });
      return Promise.resolve({ run: { id: "retest-1" }, entryId: "entry-reassessment" });
    },
    isPending: false,
    error: null,
  }),
}));

const { useRiskComposer, AttachmentError } = await import("@/hooks/conversation-composer");

const finding = { id: FINDING, status: "at_risk" } as Finding;
let ticketStatus = "in_progress";
let selectedControlId: string | null = CONTROL;
const ticket = () =>
  ({
    id: TICKET,
    type: "remediation",
    status: ticketStatus,
    selected_control_id: selectedControlId,
  }) as Ticket;

let container: HTMLDivElement;
let root: Root;
let composer: ReturnType<typeof useRiskComposer>;

function Probe({
  can,
  retests,
}: {
  can: (capability: string) => boolean;
  retests: RetestRun[] | undefined;
}) {
  composer = useRiskComposer({
    conversation: { id: CONVERSATION } as never,
    finding,
    ticket: ticket(),
    retests,
    can: can as never,
  });
  return null;
}

function render({
  can = () => true,
  retests = [] as RetestRun[] | undefined,
}: { can?: (capability: string) => boolean; retests?: RetestRun[] | undefined } = {}) {
  act(() => root.render(<Probe can={can} retests={retests} />));
}

async function submit(submission: ComposerSubmission) {
  let thrown: unknown;
  await act(async () => {
    try {
      await composer.submit(submission);
    } catch (error) {
      thrown = error;
    }
  });
  return thrown;
}

beforeEach(() => {
  calls = [];
  uploads = [];
  uploadFails = false;
  definitions = [approach()];
  definitionsFailed = false;
  completedRows();
  ticketStatus = "in_progress";
  selectedControlId = CONTROL;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const file = () => new File(["x"], "example-evidence.png", { type: "image/png" });

describe("routing a submission to its workflow", () => {
  it("posts an ordinary message when no action is attached", async () => {
    render();
    await submit({ message: "A question." });

    expect(calls).toEqual([{ name: "message", input: { message: "A question.", file: undefined } }]);
  });

  it("calls the classification mutation with the message as its reason", async () => {
    render();
    await submit({
      message: "Verified on the current build.",
      action: { kind: "classification", status: "reduced_risk" },
    });

    expect(calls).toEqual([
      {
        name: "classify",
        input: { status: "reduced_risk", reason: "Verified on the current build." },
      },
    ]);
  });

  it("calls the reassessment mutation and carries the message as context", async () => {
    render();
    await submit({ message: "Fixed in build 2.1.", action: { kind: "reassessment" } });

    expect(calls).toEqual([
      {
        name: "reassessment",
        input: { findingId: FINDING, ticketId: TICKET, message: "Fixed in build 2.1." },
      },
    ]);
  });

  it("never posts a second ordinary message alongside an action", async () => {
    render();
    await submit({ message: "Verified.", action: { kind: "classification", status: "inconclusive" } });
    await submit({ message: "Context.", action: { kind: "reassessment" } });

    expect(calls.map((call) => call.name)).toEqual(["classify", "reassessment"]);
  });
});

describe("attaching a file to the entry the action created", () => {
  it("attaches an ordinary message's file through the message itself", async () => {
    render();
    await submit({ message: "See this.", file: file() });

    expect(calls[0].input).toMatchObject({ message: "See this." });
    expect(uploads).toEqual([]);
  });

  it("attaches to the classification entry, not to a new message", async () => {
    render();
    await submit({
      message: "Verified.",
      file: file(),
      action: { kind: "classification", status: "reduced_risk" },
    });

    expect(uploads).toEqual([
      { conversationId: CONVERSATION, entryId: "entry-classification", fileName: "example-evidence.png" },
    ]);
    expect(calls.map((call) => call.name)).toEqual(["classify"]);
  });

  it("attaches to the reassessment request event", async () => {
    render();
    await submit({ message: "", file: file(), action: { kind: "reassessment" } });

    expect(uploads).toEqual([
      { conversationId: CONVERSATION, entryId: "entry-reassessment", fileName: "example-evidence.png" },
    ]);
  });
});

describe("when the file cannot be stored", () => {
  it("reports an attachment failure rather than a workflow failure", async () => {
    render();
    uploadFails = true;
    const thrown = await submit({
      message: "Verified.",
      file: file(),
      action: { kind: "classification", status: "reduced_risk" },
    });

    expect(thrown).toBeInstanceOf(AttachmentError);
    expect((thrown as Error).message).toContain("could not be attached");
  });

  it("retries the file alone, so the decision is never recorded twice", async () => {
    render();
    uploadFails = true;
    await submit({
      message: "Verified.",
      file: file(),
      action: { kind: "classification", status: "reduced_risk" },
    });
    expect(composer.attachmentRetry).toMatchObject({ entryId: "entry-classification" });

    uploadFails = false;
    const thrown = await submit({
      message: "Verified.",
      file: file(),
      action: { kind: "classification", status: "reduced_risk" },
    });

    expect(thrown).toBeUndefined();
    expect(calls.map((call) => call.name)).toEqual(["classify"]);
    expect(uploads).toHaveLength(1);
    expect(composer.attachmentRetry).toBeNull();
  });

  it("runs the workflow again when the reader replaces the file first", async () => {
    render();
    uploadFails = true;
    await submit({ message: "Verified.", file: file(), action: { kind: "reassessment" } });

    uploadFails = false;
    await submit({
      message: "Verified.",
      file: new File(["y"], "another-file.png", { type: "image/png" }),
      action: { kind: "reassessment" },
    });

    expect(calls.map((call) => call.name)).toEqual(["reassessment", "reassessment"]);
    expect(uploads[0].fileName).toBe("another-file.png");
  });
});

describe("what each reader is offered", () => {
  it("offers a security reader the classification", () => {
    render({ can: (capability) => capability === "update_finding" });
    expect(composer.offers.map((offer) => offer.kind)).toEqual(["classification"]);
  });

  it("offers a developer the reassessment", () => {
    render({ can: (capability) => capability === "request_retest" });
    expect(composer.offers.map((offer) => offer.kind)).toEqual(["reassessment"]);
  });

  it("offers a read-only reader nothing at all", () => {
    render({ can: () => false });
    expect(composer.offers).toEqual([]);
  });

  it("offers the request once every step of the selected approach is done", () => {
    render({ can: (capability) => capability === "request_retest" });
    expect(composer.offers[0].blockedReason).toBeNull();
  });

  it("blocks the request until every step is completed", () => {
    definitions = [approach(["step-one", "step-two"])];
    completedRows(["step-one", "step-two"]);
    stepRows = [
      { id: "a", ticket_control_id: "tc-1", step_key: "step-one", status: "completed" },
      { id: "b", ticket_control_id: "tc-1", step_key: "step-two", status: "not_started" },
    ];
    render({ can: (capability) => capability === "request_retest" });

    expect(composer.offers[0].blockedReason).toBe(
      "Complete all 2 steps of the selected approach first — 1 done.",
    );
  });

  it("blocks the request when the approach has no steps at all", () => {
    definitions = [approach([])];
    controlRows = [{ id: "tc-1", ticket_id: TICKET, control_id: CONTROL, status: "not_started" }];
    stepRows = [];
    render({ can: (capability) => capability === "request_retest" });

    expect(composer.offers[0].blockedReason).toBe("This approach has no steps to complete yet.");
  });

  it("blocks the request when the risk has no approach to follow", () => {
    definitions = [];
    selectedControlId = null;
    render({ can: (capability) => capability === "request_retest" });
    expect(composer.offers[0].blockedReason).toBe(
      "Choose a remediation approach and complete its steps first.",
    );
  });

  it("blocks the request once security has finished with the remediation", () => {
    ticketStatus = "closed";
    render({ can: (capability) => capability === "request_retest" });
    expect(composer.offers[0].blockedReason).toBe("Security has finished with this remediation.");
  });

  it("blocks the request on a withdrawn remediation and says to resume it", () => {
    ticketStatus = "withdrawn";
    render({ can: (capability) => capability === "request_retest" });
    expect(composer.offers[0].blockedReason).toContain("Resume it");
  });

  it("still lets a remediation recorded before the change ask for one", () => {
    ticketStatus = "fix_submitted";
    render({ can: (capability) => capability === "request_retest" });
    expect(composer.offers[0].blockedReason).toBeNull();
  });

  it("blocks the request when the approaches could not be loaded", () => {
    definitionsFailed = true;
    render({ can: (capability) => capability === "request_retest" });
    expect(composer.offers[0].blockedReason).toContain("could not be loaded");
  });

  it("blocks the request when the stored approach is no longer in the playbook", () => {
    definitions = [{ ...approach(), control_id: "example-replacement-control" }];
    render({ can: (capability) => capability === "request_retest" });
    expect(composer.offers[0].blockedReason).toContain("no longer in the playbook");
  });

  it("blocks the request until the approach's rows are reconciled", () => {
    definitions = [approach(["step-one", "step-two"])];
    completedRows(["step-one"]);
    render({ can: (capability) => capability === "request_retest" });
    expect(composer.offers[0].blockedReason).toBe("Preparing this approach's steps…");
  });

  it("blocks a second request while one is already queued", () => {
    render({
      can: (capability) => capability === "request_retest",
      retests: [{ id: "retest-1", status: "queued" } as RetestRun],
    });

    const offer = composer.offers[0];
    expect(offer.blockedReason).toContain("A reassessment has been requested");
  });

  it("blocks the request once security has started running it", () => {
    render({
      can: (capability) => capability === "request_retest",
      retests: [{ id: "retest-1", status: "running" } as RetestRun],
    });

    expect(composer.offers[0].blockedReason).toContain("already started verifying");
  });

  it("names the risk's current classification so it cannot be offered again", () => {
    render({ can: (capability) => capability === "update_finding" });
    const offer = composer.offers[0];
    expect(offer.kind === "classification" && offer.currentStatus).toBe("at_risk");
  });
});
