import { describe, expect, test } from "bun:test";
import { getOllamaModelDetails } from "../src/ai-providers";
import { withMockedFetch, type FetchLike } from "./_helpers";

describe("Ollama provider behavior", () => {
  test("getOllamaModelDetails posts the documented model field and returns provider-declared capabilities", async () => {
    let capturedBody = "";
    const mockFetch: FetchLike = async (_input, init) => {
      capturedBody = typeof init?.body === "string" ? init.body : "";
      return new Response(
        JSON.stringify({
          details: {
            family: "gemma3",
            parameter_size: "4.3B",
            quantization_level: "Q4_K_M",
          },
          capabilities: ["completion", "vision"],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await withMockedFetch(mockFetch, () => getOllamaModelDetails("gemma3"));

    expect(JSON.parse(capturedBody)).toEqual({ model: "gemma3" });
    expect(result.ok).toBeTrue();
    expect(result.data).toEqual({
      name: "gemma3",
      family: "gemma3",
      parameterSize: "4.3B",
      quantizationLevel: "Q4_K_M",
      capabilities: ["completion", "vision"],
    });
  });

  test("getOllamaModelDetails does not synthesize chat capability when the provider omits capabilities", async () => {
    const mockFetch: FetchLike = async () => new Response(
      JSON.stringify({
        details: {
          family: "llama",
          parameter_size: "8B",
          quantization_level: "Q4_K_M",
        },
        template: "{{ .Prompt }}",
        model_info: {
          "llama.embedding_length": 4096,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

    const result = await withMockedFetch(mockFetch, () => getOllamaModelDetails("llama3"));

    expect(result.ok).toBeTrue();
    expect(result.data?.capabilities).toEqual([]);
  });
});
