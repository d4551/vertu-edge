import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "../src/ai-providers";
import { chatCompletion, listProviderModels } from "../src/ai-providers";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type HeaderRecord = Record<string, string>;
type HeaderInit = RequestInit["headers"];

function toHeaderRecord(headers: HeaderInit | undefined): HeaderRecord {
  const out: HeaderRecord = {};
  if (!headers) return out;
  if (headers instanceof Headers) {
    for (const [key, value] of headers.entries()) {
      out[key] = value;
    }
    return out;
  }
  if (Array.isArray(headers)) {
    for (const entry of headers) {
      const key = entry?.[0];
      const value = entry?.[1];
      if (typeof key !== "string" || typeof value !== "string") {
        continue;
      }
      out[key] = value;
    }
    return out;
  }
  return headers as HeaderRecord;
}

async function withMockedFetch<T>(mockFetch: FetchLike, action: () => Promise<T>): Promise<T> {
  const previousFetch = globalThis.fetch;
  (globalThis as { fetch: FetchLike }).fetch = mockFetch;
  try {
    return await action();
  } finally {
    (globalThis as { fetch: FetchLike }).fetch = previousFetch;
  }
}

describe("Hugging Face provider behavior", () => {
  test("listProviderModels reads OpenAI-style /v1/models payload for Hugging Face", async () => {
    let captured = "";
    let capturedAuth = "";
    const mockFetch: FetchLike = async (input, init) => {
      const request = typeof input === "string" ? new URL(input) : input instanceof URL ? input : new URL(input.url);
      captured = request.toString();
      capturedAuth = toHeaderRecord(init?.headers)["Authorization"] ?? "";
      return new Response(
        JSON.stringify({
          data: [
            { id: "meta-llama/Meta-Llama-3.1-8B-Instruct" },
            { id: "mistralai/Mistral-7B-Instruct-v0.2" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await withMockedFetch(mockFetch, () =>
      listProviderModels("huggingface", "hf_test_token", "https://router.huggingface.co/v1")
    );

    expect(result.ok).toBeTrue();
    expect(captured).toBe("https://router.huggingface.co/v1/models");
    expect(result.data?.models).toEqual([
      "meta-llama/Meta-Llama-3.1-8B-Instruct",
      "mistralai/Mistral-7B-Instruct-v0.2",
    ]);
    expect(capturedAuth).toBe("Bearer hf_test_token");
  });

  test("listProviderModels retries with /v1 prefix when Hugging Face base URL omits it", async () => {
    const calls: string[] = [];
    const mockFetch: FetchLike = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(url);
      if (url.endsWith("/models") && !url.endsWith("/v1/models")) {
        return new Response("not found", { status: 404, headers: { "content-type": "application/json" } });
      }
      return new Response(
        JSON.stringify({ data: [{ id: "meta-llama/Meta-Llama-3.1-8B-Instruct" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await withMockedFetch(mockFetch, () =>
      listProviderModels("huggingface", "hf_test_token", "https://router.huggingface.co")
    );

    expect(result.ok).toBeTrue();
    expect(calls).toEqual([
      "https://router.huggingface.co/models",
      "https://router.huggingface.co/v1/models",
    ]);
    expect(result.data?.models).toEqual(["meta-llama/Meta-Llama-3.1-8B-Instruct"]);
  });

  test("listProviderModels parses top-level model array payload", async () => {
    const mockFetch: FetchLike = async () => new Response(
      JSON.stringify(["mistralai/Mistral-7B-Instruct-v0.2", "meta-llama/Meta-Llama-3.1-8B-Instruct"]),
      { status: 200, headers: { "content-type": "application/json" } },
    );

    const result = await withMockedFetch(mockFetch, () =>
      listProviderModels("huggingface", "hf_test_token", "https://router.huggingface.co/v1")
    );

    expect(result.ok).toBeTrue();
    expect(result.data?.models).toEqual([
      "mistralai/Mistral-7B-Instruct-v0.2",
      "meta-llama/Meta-Llama-3.1-8B-Instruct",
    ]);
  });

  test("chatCompletion uses Hugging Face OpenAI-compatible chat endpoint and parses assistant content", async () => {
    let captured = "";
    let capturedAuth = "";
    const mockFetch: FetchLike = async (input, init) => {
      const request = typeof input === "string" ? new URL(input) : input instanceof URL ? input : new URL(input.url);
      captured = request.toString();
      capturedAuth = toHeaderRecord(init?.headers).Authorization ?? "";
      if (request.pathname === "/v1/chat/completions" || request.pathname === "/chat/completions") {
        return new Response(
          JSON.stringify({
            choices: [{
              message: {
                role: "assistant",
                content: "Hugging Face chat is alive",
              },
            }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(`unexpected endpoint: ${request.pathname}`, { status: 404 });
    };

    const messages: ChatMessage[] = [{ role: "user", content: "Check status" }];
    const result = await withMockedFetch(mockFetch, () =>
      chatCompletion(
        "huggingface",
        "hf_test_token",
        "meta-llama/Meta-Llama-3.1-8B-Instruct",
        messages,
        "https://router.huggingface.co/v1",
      )
    );

    expect(result.ok).toBeTrue();
    expect(result.data).toBe("Hugging Face chat is alive");
    expect(captured).toBe("https://router.huggingface.co/v1/chat/completions");
    expect(capturedAuth).toBe("Bearer hf_test_token");
  });
});
