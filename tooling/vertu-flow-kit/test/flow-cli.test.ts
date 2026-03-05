import { expect, test } from "bun:test";
import { compileFlowFile, validateFlowFile, validateModelManifestFile } from "../src/commands";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("validate and compile flow fixture", () => {
  const flowPath = resolve(import.meta.dir, "..", "..", "..", "contracts", "fixtures", "contact-flow.yaml");
  validateFlowFile(flowPath);

  const outputPath = compileFlowFile(flowPath);
  const compiled = JSON.parse(readFileSync(resolve(outputPath), "utf-8")) as {
    appId: string;
    steps: Array<string | Record<string, string>>;
  };
  expect(compiled.appId).toBe("com.vertu.edge");
  expect(compiled.steps.length).toBeGreaterThan(0);
});

test("validate model manifest fixture", () => {
  const manifestPath = resolve(
    import.meta.dir,
    "..",
    "..",
    "..",
    "model_allowlist.json",
  );
  validateModelManifestFile(manifestPath);
});
