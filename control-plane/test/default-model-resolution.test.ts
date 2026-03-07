import { expect, test, describe } from "bun:test";
import {
  DEFAULT_CHAT_MODEL,
  SUPPORTED_THEMES,
  PROVIDER_REGISTRY,
} from "../src/config";

// ---------------------------------------------------------------------------
// DEFAULT_CHAT_MODEL alignment
// ---------------------------------------------------------------------------

describe("Default chat model resolution", () => {
  test("DEFAULT_CHAT_MODEL does not reference OpenAI gpt models", () => {
    const lower = DEFAULT_CHAT_MODEL.toLowerCase();
    expect(lower).not.toContain("gpt");
    expect(lower).not.toContain("openai");
  });

  test("DEFAULT_CHAT_MODEL resolves to a HuggingFace-aligned model", () => {
    // The resolved model should come from the HuggingFace provider (the configured defaultSource)
    // via the canonical provider registry.
    expect(DEFAULT_CHAT_MODEL.length).toBeGreaterThan(0);
    // Verify it matches the first HuggingFace default model from PROVIDER_REGISTRY
    const hfProvider = PROVIDER_REGISTRY.find((p) => p.id.toLowerCase() === "huggingface");
    if (hfProvider && hfProvider.defaultModels.length > 0) {
      expect(DEFAULT_CHAT_MODEL).toBe(hfProvider.defaultModels[0]!.trim());
    }
  });

  test("PROVIDER_REGISTRY includes HuggingFace provider", () => {
    const hfProvider = PROVIDER_REGISTRY.find((p) => p.id.toLowerCase() === "huggingface");
    expect(hfProvider).toBeDefined();
    expect(hfProvider!.defaultModels.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// SUPPORTED_THEMES expanded set
// ---------------------------------------------------------------------------

describe("Supported themes", () => {
  test("SUPPORTED_THEMES contains exactly the 3 Vertu-branded themes", () => {
    expect(SUPPORTED_THEMES).toEqual(["dark", "light", "luxury"]);
  });

  test("SUPPORTED_THEMES includes core themes (dark, light, luxury)", () => {
    expect(SUPPORTED_THEMES).toContain("dark");
    expect(SUPPORTED_THEMES).toContain("light");
    expect(SUPPORTED_THEMES).toContain("luxury");
  });

  test("SUPPORTED_THEMES has no duplicates", () => {
    const unique = new Set(SUPPORTED_THEMES);
    expect(unique.size).toBe(SUPPORTED_THEMES.length);
  });
});
