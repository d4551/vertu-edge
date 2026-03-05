#!/usr/bin/env bun

import {
  compileFlowFile,
  doctor,
  validateFlowFile,
  validateModelManifestFile,
} from "./commands";

/** Entry point for vertu-flow command line usage. */
function main(argv: string[]): number {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(
      [
        "Usage:",
        "  vertu-flow validate <flow.yaml>",
        "  vertu-flow validate-model-manifest <manifest.json>",
        "  vertu-flow compile <flow.yaml> [output.json]",
        "  vertu-flow doctor",
      ].join("\n") + "\n",
    );
    return 0;
  }

  if (command === "validate") {
    const flowPath = rest[0];
    if (!flowPath) {
      throw new Error("Missing flow path for validate command");
    }
    validateFlowFile(flowPath);
    return 0;
  }

  if (command === "validate-model-manifest") {
    const manifestPath = rest[0];
    if (!manifestPath) {
      throw new Error("Missing manifest path for validate-model-manifest command");
    }
    validateModelManifestFile(manifestPath);
    return 0;
  }

  if (command === "compile") {
    const flowPath = rest[0];
    const outputPath = rest[1];
    if (!flowPath) {
      throw new Error("Missing flow path for compile command");
    }
    compileFlowFile(flowPath, outputPath);
    return 0;
  }

  if (command === "doctor") {
    doctor();
    return 0;
  }

  throw new Error(`Unknown command: ${command}`);
}

Promise.resolve()
  .then(() => main(process.argv.slice(2)))
  .then(
    (exitCode) => {
      process.exit(exitCode);
    },
    (failure) => {
      const message = failure instanceof Error ? failure.message : String(failure);
      process.stderr.write(`${message}\n`);
      process.exit(1);
    },
  );
