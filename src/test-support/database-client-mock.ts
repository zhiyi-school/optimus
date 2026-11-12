/**
 * Vitest setup: replaces the Supabase client module in every test so none needs `.env`; a test's own `vi.mock` takes precedence.
 */

import { vi } from "vitest";

vi.mock("@/database/client", () => ({
  ATTACHMENTS_BUCKET: "ticket-attachments",
  EVIDENCE_BUCKET: "evidence",
  supabase: new Proxy(
    {},
    {
      get(_target, property) {
        // Symbol and thenable probes come from tooling, not from a test calling Supabase.
        if (typeof property === "symbol" || property === "then") return undefined;
        throw new Error(
          `Test used supabase.${property} without mocking "@/database/client"; add a vi.mock for it in the test file.`,
        );
      },
    },
  ),
}));
