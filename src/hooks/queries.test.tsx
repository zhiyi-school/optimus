// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RiskConversationEntry } from "@/data/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONVERSATION = "example-conversation-id";

let stored: RiskConversationEntry[] = [];
let reads = 0;
let subscriptions = 0;
let unsubscribes = 0;
let notify: (() => void) | undefined;
let calls: string[] = [];
let owners: Record<string, unknown>[] = [];
let detailFetch: () => Promise<unknown> = () => Promise.resolve(null);
let runRequestCalls = 0;
let runRequest: unknown = null;

function entry(id: string): RiskConversationEntry {
  return {
    id,
    conversation_id: CONVERSATION,
    kind: "message",
    author_id: null,
    message: id,
    metadata: {},
    source_ticket_id: null,
    created_at: "2026-01-01T00:00:00Z",
    seq: stored.length + 1,
  };
}

vi.mock("@/data/supabase", () => ({
  ATTACHMENTS_BUCKET: "ticket-attachments",
  EVIDENCE_BUCKET: "evidence",
  supabase: { from: () => ({}), auth: {}, storage: { from: () => ({}) } },
}));

vi.mock("@/data/services", () => ({
  assessmentData: {
    getWithApplication: () => detailFetch(),
  },
  assessmentRunRequestData: {
    findForAssessment: () => {
      runRequestCalls += 1;
      return Promise.resolve(runRequest);
    },
  },
  riskConversationData: {
    find: (applicationId: string, riskId: string) => {
      calls.push("find");
      owners.push({ applicationId, riskId });
      return Promise.resolve(null);
    },
    getOrCreate: (owner: Record<string, unknown>) => {
      calls.push("getOrCreate");
      owners.push(owner);
      return Promise.resolve({
        id: CONVERSATION,
        application_id: "example-app-id",
        origin_assessment_id: owner.originAssessmentId ?? null,
        risk_id: "example-feature-01-risk-01",
        finding_id: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      });
    },
    listEntries: () => {
      reads += 1;
      return Promise.resolve([...stored]);
    },
    subscribeToConversation: (_id: string, onChange: () => void) => {
      subscriptions += 1;
      notify = onChange;
      return () => {
        unsubscribes += 1;
      };
    },
  },
}));

vi.mock("@/api/automation-services", () => ({
  assessmentApi: {},
  configApi: {},
  provisioningApi: {},
  syncApi: {},
  testApi: {},
}));

vi.mock("@/api/playbook-services", () => ({ playbookApi: {} }));

const { useAssessment, useAssessmentRunRequest, useRiskConversation, useRiskConversationEntries } =
  await import("@/hooks/queries");

let container: HTMLDivElement;
let root: Root;

function Probe() {
  const { data } = useRiskConversationEntries(CONVERSATION);
  return (
    <ul>
      {(data ?? []).map((item) => (
        <li key={item.id}>{item.id}</li>
      ))}
    </ul>
  );
}

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    ),
  );
  await settle();
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// The realtime callback invalidates; the refetch it schedules resolves later,
// so the render has to be flushed before it can be read.
async function fire(times = 1) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => notify?.());
    await settle();
  }
}

function rendered() {
  return [...container.querySelectorAll("li")].map((item) => item.textContent);
}

beforeEach(() => {
  stored = [entry("first")];
  reads = 0;
  subscriptions = 0;
  unsubscribes = 0;
  notify = undefined;
  calls = [];
  owners = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useRiskConversationEntries", () => {
  it("subscribes once for the open conversation", async () => {
    await mount();
    expect(subscriptions).toBe(1);
  });

  it("releases the subscription when the page closes", async () => {
    await mount();
    act(() => root.unmount());
    expect(unsubscribes).toBe(1);
    root = createRoot(container);
  });

  it("shows an entry that arrived over realtime", async () => {
    await mount();
    stored = [...stored, entry("second")];
    await fire();

    expect(rendered()).toEqual(["first", "second"]);
  });

  it("does not duplicate an entry when realtime fires more than once", async () => {
    await mount();
    stored = [...stored, entry("second")];
    await fire(3);

    expect(rendered()).toEqual(["first", "second"]);
  });

  it("re-reads the thread rather than appending to what it already had", async () => {
    await mount();
    const before = reads;
    await fire();

    expect(reads).toBeGreaterThan(before);
    expect(rendered()).toEqual(["first"]);
  });
});

describe("useAssessmentRunRequest polling and focus", () => {
  function RunRequestProbe({ status }: { status: string }) {
    const { data } = useAssessmentRunRequest("example-assessment-id", { status } as never);
    return <p>{data ? "loaded" : "none"}</p>;
  }

  async function mountRunRequest(status: string) {
    // Mirrors the application's client defaults (see main.tsx), so this proves
    // the hook no longer overrides them back to focus-refetching.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    });
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <RunRequestProbe status={status} />
        </QueryClientProvider>,
      ),
    );
    await settle();
    return client;
  }

  /** The interval the hook would actually schedule for the mounted query. */
  function pollInterval(client: QueryClient) {
    const query = client
      .getQueryCache()
      .find({ queryKey: ["assessmentRunRequest", "example-assessment-id"] })!;
    const { refetchInterval } = query.observers[0].options;
    return typeof refetchInterval === "function" ? refetchInterval(query) : refetchInterval;
  }

  function focusRefetch(client: QueryClient) {
    const query = client
      .getQueryCache()
      .find({ queryKey: ["assessmentRunRequest", "example-assessment-id"] })!;
    return query.observers[0].options.refetchOnWindowFocus;
  }

  it("keeps polling while the assessment is still moving", async () => {
    runRequest = { id: "example-request-id", status: "queued" };
    const client = await mountRunRequest("queued");
    expect(pollInterval(client)).toBe(10_000);
  });

  it("stops polling once the request has settled", async () => {
    runRequest = { id: "example-request-id", status: "completed" };
    const client = await mountRunRequest("completed");
    expect(pollInterval(client)).toBe(false);
  });

  it("does not opt into refetching on window focus", async () => {
    runRequest = { id: "example-request-id", status: "completed" };
    const client = await mountRunRequest("completed");
    expect(focusRefetch(client)).not.toBe(true);
  });

  it("does not fetch again when the window regains focus", async () => {
    runRequest = { id: "example-request-id", status: "completed" };
    await mountRunRequest("completed");
    const initial = runRequestCalls;

    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await settle();

    expect(runRequestCalls).toBe(initial);
  });
});

describe("useAssessment seeding from the cached list", () => {
  function AssessmentProbe({ id }: { id: string }) {
    const { data, isLoading } = useAssessment(id);
    return <p>{isLoading ? "loading" : data ? `status:${(data as { status: string }).status}` : "none"}</p>;
  }

  async function mountDetail(client: QueryClient, id = "example-assessment-id") {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <AssessmentProbe id={id} />
        </QueryClientProvider>,
      ),
    );
  }

  function clientWithList() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(
      ["assessments"],
      [{ id: "example-assessment-id", status: "queued", application: null }],
    );
    return client;
  }

  it("renders the cached row immediately instead of a loading state", async () => {
    let resolveDetail: (value: unknown) => void = () => {};
    detailFetch = () => new Promise((resolve) => (resolveDetail = resolve));

    await mountDetail(clientWithList());
    expect(container.textContent).toBe("status:queued");

    await act(async () => resolveDetail({ id: "example-assessment-id", status: "completed" }));
    await settle();
    expect(container.textContent).toBe("status:completed");
  });

  it("still loads normally when the list cache holds nothing for that id", async () => {
    detailFetch = () => new Promise(() => {});
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await mountDetail(client);
    expect(container.textContent).toBe("loading");
  });
});

describe("useRiskConversation", () => {
  function ConversationProbe({
    create,
    applicationId = "example-app-id",
  }: {
    create: boolean;
    applicationId?: string;
  }) {
    const { data } = useRiskConversation(applicationId, "example-feature-01-risk-01", null, {
      create,
      originAssessmentId: "example-assessment-id",
    });
    return <p>{data ? data.id : "none"}</p>;
  }

  async function mountProbe(create: boolean, applicationId?: string) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <ConversationProbe create={create} applicationId={applicationId} />
        </QueryClientProvider>,
      ),
    );
    await settle();
  }

  it("opens the thread for someone who may post in it", async () => {
    await mountProbe(true);
    expect(calls).toEqual(["getOrCreate"]);
    expect(container.textContent).toBe(CONVERSATION);
  });

  it("only looks one up for a read-only viewer, never creating on their behalf", async () => {
    await mountProbe(false);
    expect(calls).toEqual(["find"]);
    expect(container.textContent).toBe("none");
  });

  it("asks for the conversation by application and risk, with the assessment as context", async () => {
    await mountProbe(true);
    expect(owners).toEqual([
      {
        applicationId: "example-app-id",
        riskId: "example-feature-01-risk-01",
        findingId: null,
        originAssessmentId: "example-assessment-id",
      },
    ]);
  });

  it("looks one up by application and risk alone for a read-only viewer", async () => {
    await mountProbe(false);
    expect(owners).toEqual([
      { applicationId: "example-app-id", riskId: "example-feature-01-risk-01" },
    ]);
  });

  it("caches per application, so another application is a different thread", async () => {
    await mountProbe(true);
    await mountProbe(true, "example-other-app-id");

    expect(owners.map((owner) => owner.applicationId)).toEqual([
      "example-app-id",
      "example-other-app-id",
    ]);
  });
});
