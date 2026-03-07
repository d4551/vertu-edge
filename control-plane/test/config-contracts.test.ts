import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const CONTROL_PLANE_ROOT = join(import.meta.dir, "..");
const textDecoder = new TextDecoder();

type SpawnResult = ReturnType<typeof Bun.spawnSync>;

function decode(buffer: SpawnResult["stdout"] | SpawnResult["stderr"]): string {
  return textDecoder.decode(buffer).trim();
}

function runConfigProbe(
  script: string,
  envOverrides: Record<string, string | undefined>,
): SpawnResult {
  return Bun.spawnSync([process.execPath, "--eval", script], {
    cwd: CONTROL_PLANE_ROOT,
    env: {
      ...process.env,
      ...envOverrides,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("control-plane config contracts", () => {
  test("rejects legacy array-style model source registry overrides", () => {
    const result = runConfigProbe(
      "await import('./src/config');",
      {
        MODEL_SOURCE_REGISTRY_JSON: JSON.stringify([
          {
            id: "huggingface",
            displayName: "Hugging Face",
            modelRefPlaceholder: "owner/repo",
            modelRefValidation: "huggingface",
          },
        ]),
      },
    );

    expect(result.exitCode).toBe(1);
    expect(`${decode(result.stdout)}\n${decode(result.stderr)}`).toContain(
      "Expected JSON object with a non-empty sources array.",
    );
  });

  test("fails closed when no provider declares a default chat model", () => {
    const result = runConfigProbe(
      "const config = await import('./src/config'); process.stdout.write(config.DEFAULT_CHAT_MODEL);",
      {
        AI_PROVIDER_REGISTRY_JSON: JSON.stringify([
          {
            id: "ollama",
            displayName: "Ollama",
            baseUrl: "http://localhost:11434",
            requiresKey: false,
            hasBaseUrlConfig: true,
            defaultModels: [],
            docsUrl: "https://github.com/ollama/ollama/blob/main/docs/api.md",
          },
        ]),
        DEFAULT_CHAT_MODEL: undefined,
      },
    );

    expect(result.exitCode).toBe(1);
    expect(`${decode(result.stdout)}\n${decode(result.stderr)}`).toContain(
      "No provider default models are configured",
    );
  });
});
