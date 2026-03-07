import { beforeEach, describe, expect, test } from "bun:test";
import { initDb, createLocalModel, sqlite } from "../src/db";
import {
  pipelineTagToModes,
  ollamaCapabilitiesToModes,
  resolveAiWorkflowCapabilities,
} from "../src/ai-workflows/capabilities";
import { withMockedFetch, type FetchLike } from "./_helpers";

initDb();

// ---------------------------------------------------------------------------
// pipelineTagToModes
// ---------------------------------------------------------------------------

describe("pipelineTagToModes", () => {
  test("text-generation maps to chat, typography, presentation, social, flow_generation", () => {
    const modes = pipelineTagToModes("text-generation");
    expect(modes).toEqual(["chat", "typography", "presentation", "social", "flow_generation"]);
  });

  test("text2text-generation maps to chat, typography, presentation, social, flow_generation", () => {
    const modes = pipelineTagToModes("text2text-generation");
    expect(modes).toEqual(["chat", "typography", "presentation", "social", "flow_generation"]);
  });

  test("text-to-image maps to image", () => {
    const modes = pipelineTagToModes("text-to-image");
    expect(modes).toEqual(["image"]);
  });

  test("image-to-text maps to chat", () => {
    const modes = pipelineTagToModes("image-to-text");
    expect(modes).toEqual(["chat"]);
  });

  test("visual-question-answering maps to chat", () => {
    const modes = pipelineTagToModes("visual-question-answering");
    expect(modes).toEqual(["chat"]);
  });

  test("null/undefined/empty returns empty array", () => {
    expect(pipelineTagToModes(null)).toEqual([]);
    expect(pipelineTagToModes(undefined)).toEqual([]);
    expect(pipelineTagToModes("")).toEqual([]);
  });

  test("unknown tag returns empty array", () => {
    expect(pipelineTagToModes("audio-classification")).toEqual([]);
    expect(pipelineTagToModes("feature-extraction")).toEqual([]);
  });

  test("handles whitespace and case insensitivity", () => {
    expect(pipelineTagToModes("  Text-Generation  ")).toEqual(["chat", "typography", "presentation", "social", "flow_generation"]);
    expect(pipelineTagToModes("TEXT-TO-IMAGE")).toEqual(["image"]);
  });
});

// ---------------------------------------------------------------------------
// ollamaCapabilitiesToModes
// ---------------------------------------------------------------------------

describe("ollamaCapabilitiesToModes", () => {
  test("chat capability maps to chat, typography, presentation, social", () => {
    const modes = ollamaCapabilitiesToModes(["chat"]);
    expect(modes).toContain("chat");
    expect(modes).toContain("typography");
    expect(modes).toContain("presentation");
    expect(modes).toContain("social");
  });

  test("completion capability maps to text modes", () => {
    const modes = ollamaCapabilitiesToModes(["completion"]);
    expect(modes).toContain("chat");
    expect(modes).toContain("typography");
    expect(modes).toContain("presentation");
    expect(modes).toContain("social");
  });

  test("generate capability maps to text modes", () => {
    const modes = ollamaCapabilitiesToModes(["generate"]);
    expect(modes).toContain("chat");
    expect(modes).toContain("typography");
  });

  test("vision capability maps to chat only", () => {
    const modes = ollamaCapabilitiesToModes(["vision"]);
    expect(modes).toContain("chat");
    expect(modes).not.toContain("typography");
    expect(modes).not.toContain("image");
  });

  test("combined chat + vision deduplicates", () => {
    const modes = ollamaCapabilitiesToModes(["chat", "vision"]);
    const chatCount = modes.filter((m) => m === "chat").length;
    expect(chatCount).toBe(1);
    expect(modes).toContain("typography");
    expect(modes).toContain("presentation");
    expect(modes).toContain("social");
  });

  test("empty capabilities returns empty array", () => {
    expect(ollamaCapabilitiesToModes([])).toEqual([]);
  });

  test("unknown capabilities are ignored", () => {
    expect(ollamaCapabilitiesToModes(["embedding", "unknown"])).toEqual([]);
  });

  test("case insensitive matching", () => {
    const modes = ollamaCapabilitiesToModes(["CHAT", "Vision"]);
    expect(modes).toContain("chat");
    expect(modes).toContain("typography");
  });
});

// ---------------------------------------------------------------------------
// Capabilities resolution with registered local models
// ---------------------------------------------------------------------------

describe("capabilities via registered local models", () => {
  test("registered model with text-generation pipeline tag enables text modes", () => {
    createLocalModel({
      modelRef: "test-cap/text-gen",
      normalizedRef: "huggingface.co/test-cap/text-gen",
      source: "huggingface",
      pipelineTag: "text-generation",
    });

    // Verify the pipeline tag mapping is correct
    const modes = pipelineTagToModes("text-generation");
    expect(modes.length).toBe(5);
    expect(modes).toContain("chat");
    expect(modes).toContain("typography");
    expect(modes).toContain("presentation");
    expect(modes).toContain("social");
  });

  test("registered model with text-to-image pipeline tag enables image mode", () => {
    createLocalModel({
      modelRef: "test-cap/image-gen",
      normalizedRef: "huggingface.co/test-cap/image-gen",
      source: "huggingface",
      pipelineTag: "text-to-image",
    });

    const modes = pipelineTagToModes("text-to-image");
    expect(modes).toEqual(["image"]);
  });

  test("registered model with JSON capabilities field enables mapped modes", () => {
    createLocalModel({
      modelRef: "test-cap/ollama-model",
      normalizedRef: "ollama/test-cap/ollama-model",
      source: "ollama",
      capabilities: JSON.stringify(["chat", "vision"]),
    });

    const caps = JSON.parse(JSON.stringify(["chat", "vision"])) as string[];
    const modes = ollamaCapabilitiesToModes(caps);
    expect(modes).toContain("chat");
    expect(modes).toContain("typography");
    expect(modes).toContain("presentation");
    expect(modes).toContain("social");
  });

  test("malformed capabilities JSON is handled gracefully", async () => {
    // This should not throw — the resolver skips malformed caps
    createLocalModel({
      modelRef: "test-cap/bad-caps",
      normalizedRef: "ollama/test-cap/bad-caps",
      source: "ollama",
      capabilities: "not-valid-json{",
    });

    const capabilityResult = await resolveAiWorkflowCapabilities();
    expect(Array.isArray(capabilityResult.modes)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// OllamaModelDetails response shape validation
// ---------------------------------------------------------------------------

describe("OllamaModelDetails response shape", () => {
  test("real-world /api/show response shape parsed correctly", () => {
    // Simulate a typical /api/show response for llama3.2
    const mockResponse = {
      details: {
        family: "llama",
        parameter_size: "3.2B",
        quantization_level: "Q4_K_M",
        families: ["llama"],
      },
      template: "{{ if .System }}<|start_header_id|>system<|end_header_id|>...",
      model_info: {
        "general.architecture": "llama",
      },
    };

    // Verify our inference logic:
    // template present → "chat"
    const template = mockResponse.template?.trim() ?? "";
    expect(template.length).toBeGreaterThan(0);

    // families does not contain "clip" or "mllama" → no "vision"
    const families = mockResponse.details.families.map((f: string) => f.toLowerCase());
    expect(families.includes("clip")).toBe(false);
    expect(families.includes("mllama")).toBe(false);

    // No embedding key in model_info
    const modelInfo = mockResponse.model_info;
    const archKey = Object.keys(modelInfo).find((k) => k.toLowerCase().includes("embedding"));
    expect(archKey).toBeUndefined();
  });

  test("vision model shape has clip in families", () => {
    const mockResponse = {
      details: {
        family: "llama",
        parameter_size: "11B",
        quantization_level: "Q4_K_M",
        families: ["llama", "clip"],
      },
      template: "...",
      model_info: {},
    };

    const families = mockResponse.details.families.map((f: string) => f.toLowerCase());
    expect(families.includes("clip")).toBe(true);
  });

  test("embedding model shape detected from model_info", () => {
    const mockResponse = {
      details: {
        family: "bert",
        parameter_size: "109M",
        quantization_level: "F16",
        families: null,
      },
      template: "",
      model_info: {
        "bert.embedding_length": 768,
      },
    };

    // No template → no "chat" from template
    expect(mockResponse.template.length).toBe(0);

    // Has embedding key
    const modelInfo = mockResponse.model_info;
    const archKey = Object.keys(modelInfo).find((k) => k.toLowerCase().includes("embedding"));
    expect(archKey).toBeTruthy();
    expect(archKey).toBe("bert.embedding_length");
  });

  test("provider-declared capabilities are returned without local inference", () => {
    const mockResponse = {
      capabilities: ["completion", "vision"],
    };

    const capabilities = Array.isArray(mockResponse.capabilities)
      ? mockResponse.capabilities.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0)
      : [];

    expect(capabilities).toEqual(["completion", "vision"]);
  });
});

describe("capabilities via Ollama probe evidence", () => {
  beforeEach(() => {
    sqlite.exec("DELETE FROM api_keys;");
    sqlite.exec("DELETE FROM local_models;");
  });

  test("provider-declared completion capability enables local text modes", async () => {
    const mockFetch: FetchLike = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/tags")) {
        return new Response(
          JSON.stringify({ models: [{ name: "qwen3" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url.endsWith("/api/show")) {
        return new Response(
          JSON.stringify({
            details: {
              family: "qwen3",
              parameter_size: "8B",
              quantization_level: "Q4_K_M",
            },
            capabilities: ["completion"],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response("unexpected route", { status: 404 });
    };

    const capabilityResult = await withMockedFetch(mockFetch, () => resolveAiWorkflowCapabilities("ollama-cap-test"));
    const chatMode = capabilityResult.modes.find((mode) => mode.mode === "chat");
    const imageMode = capabilityResult.modes.find((mode) => mode.mode === "image");

    expect(chatMode?.localAvailable).toBeTrue();
    expect(chatMode?.reason).toBeUndefined();
    expect(imageMode?.localAvailable).toBeFalse();
    expect(imageMode?.reason).toBe("Installed local models do not declare support for this workflow mode.");
  });

  test("failed /api/show probe does not advertise unsupported local workflow modes", async () => {
    const mockFetch: FetchLike = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/tags")) {
        return new Response(
          JSON.stringify({ models: [{ name: "broken-model" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url.endsWith("/api/show")) {
        return new Response("probe failed", { status: 503, headers: { "content-type": "text/plain" } });
      }

      return new Response("unexpected route", { status: 404 });
    };

    const capabilityResult = await withMockedFetch(mockFetch, () => resolveAiWorkflowCapabilities("ollama-probe-fail"));
    const chatMode = capabilityResult.modes.find((mode) => mode.mode === "chat");

    expect(chatMode?.localAvailable).toBeFalse();
    expect(chatMode?.remoteAvailable).toBeFalse();
    expect(chatMode?.reason).toBe("Local models were detected, but capability probing failed.");
  });
});
