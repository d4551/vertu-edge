import { expect, test, describe } from "bun:test";
import { initDb } from "../src/db";
import {
  clearModelAssignment,
  getModelAssignment,
  setModelAssignment,
} from "../src/db";

initDb();

// ---------------------------------------------------------------------------
// Model assignment CRUD
// ---------------------------------------------------------------------------

describe("Model assignment CRUD", () => {
  test("getModelAssignment returns null when no assignment exists", () => {
    const result = getModelAssignment("nonexistent_mode");
    expect(result).toBeNull();
  });

  test("setModelAssignment persists and getModelAssignment retrieves it", () => {
    setModelAssignment("chat", "ollama", "mistral");
    const result = getModelAssignment("chat");
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("ollama");
    expect(result!.model).toBe("mistral");
  });

  test("setModelAssignment overwrites previous assignment", () => {
    setModelAssignment("image", "huggingface", "sdxl-turbo");
    const first = getModelAssignment("image");
    expect(first!.model).toBe("sdxl-turbo");

    setModelAssignment("image", "ollama", "llava");
    const second = getModelAssignment("image");
    expect(second!.provider).toBe("ollama");
    expect(second!.model).toBe("llava");
  });

  test("clearModelAssignment removes the assignment", () => {
    setModelAssignment("typography", "ollama", "gemma2");
    expect(getModelAssignment("typography")).not.toBeNull();

    clearModelAssignment("typography");
    expect(getModelAssignment("typography")).toBeNull();
  });

  test("clearModelAssignment on nonexistent mode does not throw", () => {
    expect(() => clearModelAssignment("no_such_mode")).not.toThrow();
  });

  test("each mode has independent assignments", () => {
    setModelAssignment("chat", "ollama", "llama3.2");
    setModelAssignment("image", "huggingface", "flux-dev");
    setModelAssignment("social", "ollama", "mistral");

    const chat = getModelAssignment("chat");
    const image = getModelAssignment("image");
    const social = getModelAssignment("social");

    expect(chat!.model).toBe("llama3.2");
    expect(image!.model).toBe("flux-dev");
    expect(social!.model).toBe("mistral");
  });
});

// ---------------------------------------------------------------------------
// Model assignment resolution priority (integration-level)
// ---------------------------------------------------------------------------

describe("Model assignment resolution priority", () => {
  test("explicit request model overrides assignment", () => {
    setModelAssignment("chat", "ollama", "default-model");
    // Simulating the orchestrator's resolution logic:
    const payload = { model: "explicit-model" };
    const assignedModel = !payload.model ? getModelAssignment("chat") : null;
    const effectiveModel = payload.model ?? assignedModel?.model ?? undefined;
    expect(effectiveModel).toBe("explicit-model");
  });

  test("assignment used when no explicit model", () => {
    setModelAssignment("presentation", "ollama", "assigned-model");
    const payload = { model: undefined as string | undefined };
    const assignedModel = !payload.model ? getModelAssignment("presentation") : null;
    const effectiveModel = payload.model ?? assignedModel?.model ?? undefined;
    expect(effectiveModel).toBe("assigned-model");
  });

  test("falls back to undefined when no assignment and no explicit model", () => {
    clearModelAssignment("social");
    const payload = { model: undefined as string | undefined };
    const assignedModel = !payload.model ? getModelAssignment("social") : null;
    const effectiveModel = payload.model ?? assignedModel?.model ?? undefined;
    expect(effectiveModel).toBeUndefined();
  });
});
