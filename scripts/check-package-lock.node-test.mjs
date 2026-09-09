import assert from "node:assert/strict";
import test from "node:test";
import { declarationDifferences } from "./check-package-lock.mjs";

test("dependency declaration drift is rejected", () => {
  const packageJson = { dependencies: { example: "^1.0.0" } };
  const lockJson = { packages: { "": { dependencies: { example: "^2.0.0" } } } };

  assert.deepEqual(declarationDifferences(packageJson, lockJson), ["dependencies"]);
});

