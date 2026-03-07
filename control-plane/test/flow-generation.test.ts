import { expect, test, describe } from "bun:test";
import { initDb } from "../src/db";
import { buildWorkflowPrompt, extractYamlFromResponse, isTextWorkflowMode } from "../src/ai-workflows/text-workflows";
import { parseAiWorkflowModeSelection } from "../src/ai-renderers";
import { parseAiWorkflowRequestBody } from "../src/ai-workflows/orchestrator";
import { pipelineTagToModes, ollamaCapabilitiesToModes } from "../src/ai-workflows/capabilities";
import type { AiWorkflowMode } from "../../contracts/flow-contracts";

initDb();

// ---------------------------------------------------------------------------
// AiWorkflowMode includes flow_generation
// ---------------------------------------------------------------------------

describe("AiWorkflowMode flow_generation", () => {
  test("flow_generation is a valid AiWorkflowMode", () => {
    const mode: AiWorkflowMode = "flow_generation";
    expect(mode).toBe("flow_generation");
  });

  test("parseAiWorkflowModeSelection accepts flow_generation", () => {
    expect(parseAiWorkflowModeSelection("flow_generation")).toBe("flow_generation");
  });

  test("isTextWorkflowMode includes flow_generation", () => {
    expect(isTextWorkflowMode("flow_generation")).toBe(true);
  });

  test("isTextWorkflowMode still excludes image", () => {
    expect(isTextWorkflowMode("image")).toBe(false);
  });

  test("parseAiWorkflowRequestBody accepts flow_generation mode", () => {
    const result = parseAiWorkflowRequestBody({
      mode: "flow_generation",
      message: "Create a login flow for my app",
    });
    expect(result.error).toBeUndefined();
    expect(result.request).toBeTruthy();
    expect(result.request!.mode).toBe("flow_generation");
  });
});

// ---------------------------------------------------------------------------
// buildWorkflowPrompt for flow_generation
// ---------------------------------------------------------------------------

describe("buildWorkflowPrompt for flow_generation", () => {
  test("includes Maestro commands reference", () => {
    const prompt = buildWorkflowPrompt("flow_generation", "Login flow for my banking app");
    expect(prompt).toContain("Maestro YAML");
    expect(prompt).toContain("tapOn");
    expect(prompt).toContain("launchApp");
    expect(prompt).toContain("assertVisible");
  });

  test("includes user message", () => {
    const prompt = buildWorkflowPrompt("flow_generation", "Scroll to bottom of settings page");
    expect(prompt).toContain("Scroll to bottom of settings page");
  });

  test("includes constraints when provided", () => {
    const prompt = buildWorkflowPrompt("flow_generation", "Test checkout", {
      constraints: "Use only tapOn and assertVisible",
    });
    expect(prompt).toContain("Use only tapOn and assertVisible");
  });

  test("does not include audience/tone/format for flow_generation", () => {
    const prompt = buildWorkflowPrompt("flow_generation", "Test login", {
      audience: "developers",
      tone: "formal",
      format: "markdown",
    });
    // flow_generation prompt uses FLOW_GENERATION_SYSTEM_PROMPT, not the generic one
    expect(prompt).not.toContain("Audience: developers");
    expect(prompt).not.toContain("Tone: formal");
  });
});

// ---------------------------------------------------------------------------
// extractYamlFromResponse
// ---------------------------------------------------------------------------

describe("extractYamlFromResponse", () => {
  test("extracts YAML from yaml code fence", () => {
    const reply = `Here is the flow:

\`\`\`yaml
appId: com.example.app
---
- launchApp
- tapOn:
    text: "Login"
\`\`\`

This flow launches the app and taps Login.`;

    const yaml = extractYamlFromResponse(reply);
    expect(yaml).not.toBeNull();
    expect(yaml).toContain("appId: com.example.app");
    expect(yaml).toContain("launchApp");
    expect(yaml).toContain("tapOn:");
  });

  test("extracts YAML from yml code fence", () => {
    const reply = `\`\`\`yml
appId: com.test
---
- scroll
\`\`\``;

    const yaml = extractYamlFromResponse(reply);
    expect(yaml).not.toBeNull();
    expect(yaml).toContain("appId: com.test");
  });

  test("extracts YAML from bare code fence with appId", () => {
    const reply = `\`\`\`
appId: com.example
---
- launchApp
\`\`\``;

    const yaml = extractYamlFromResponse(reply);
    expect(yaml).not.toBeNull();
    expect(yaml).toContain("appId: com.example");
  });

  test("returns null when no code fence found", () => {
    const reply = "I can help you with that, but I need more details about your app.";
    expect(extractYamlFromResponse(reply)).toBeNull();
  });

  test("returns null for bare code fence without appId", () => {
    const reply = `\`\`\`
const x = 42;
console.log(x);
\`\`\``;
    expect(extractYamlFromResponse(reply)).toBeNull();
  });

  test("handles YAML with complex commands", () => {
    const reply = `\`\`\`yaml
appId: com.banking.app
---
- launchApp
- tapOn:
    text: "Login"
- inputText: "user@example.com"
- tapOn:
    id: "password-field"
- inputText: "secret123"
- tapOn:
    text: "Submit"
- assertVisible:
    text: "Dashboard"
\`\`\``;

    const yaml = extractYamlFromResponse(reply);
    expect(yaml).not.toBeNull();
    expect(yaml).toContain("inputText");
    expect(yaml).toContain("assertVisible");
  });
});

// ---------------------------------------------------------------------------
// Capability mapping includes flow_generation
// ---------------------------------------------------------------------------

describe("Capability mapping includes flow_generation", () => {
  test("text-generation pipeline includes flow_generation", () => {
    const modes = pipelineTagToModes("text-generation");
    expect(modes).toContain("flow_generation");
  });

  test("text2text-generation pipeline includes flow_generation", () => {
    const modes = pipelineTagToModes("text2text-generation");
    expect(modes).toContain("flow_generation");
  });

  test("image pipelines do not include flow_generation", () => {
    const modes = pipelineTagToModes("text-to-image");
    expect(modes).not.toContain("flow_generation");
  });

  test("ollama chat capability includes flow_generation", () => {
    const modes = ollamaCapabilitiesToModes(["chat"]);
    expect(modes).toContain("flow_generation");
  });

  test("ollama completion capability includes flow_generation", () => {
    const modes = ollamaCapabilitiesToModes(["completion"]);
    expect(modes).toContain("flow_generation");
  });
});
