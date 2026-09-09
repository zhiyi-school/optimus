#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

export function declarationDifferences(packageJson, lockJson) {
  const lockRoot = lockJson.packages?.[""];
  if (!lockRoot) return ["root package entry"];
  const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  const differences = [];
  for (const section of sections) {
    const declared = packageJson[section] ?? {};
    const locked = lockRoot[section] ?? {};
    if (JSON.stringify(declared) !== JSON.stringify(locked)) differences.push(section);
  }
  return differences;
}

export function checkFiles(packagePath, lockPath) {
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  const lockJson = JSON.parse(readFileSync(lockPath, "utf8"));
  return declarationDifferences(packageJson, lockJson);
}

function main() {
  const argumentsByName = new Map();
  for (let index = 2; index < process.argv.length; index += 2) {
    argumentsByName.set(process.argv[index], process.argv[index + 1]);
  }
  const differences = checkFiles(
    resolve(argumentsByName.get("--package") ?? "package.json"),
    resolve(argumentsByName.get("--lock") ?? "package-lock.json"),
  );
  if (differences.length) {
    console.error(`package-lock.json root metadata differs in: ${differences.join(", ")}`);
    console.error("Run npm install --package-lock-only after changing package.json");
    return 1;
  }
  console.log("package.json and package-lock.json declarations agree");
  return 0;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(main());
