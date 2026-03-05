/**
 * HuggingFace Hub model search client.
 * Uses the public REST API at https://huggingface.co/api/models.
 * No dependencies — relies on Bun's native fetch.
 */

import { safeParseJson, type JsonRecord, type JsonValue } from "./config";
import type { HfModelSearchHit } from "../../contracts/flow-contracts";

const HF_API_BASE = "https://huggingface.co/api/models";
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;
const FETCH_TIMEOUT_MS = 8_000;

/** Supported HuggingFace sort keys accepted by the public model-search API. */
export type HfSort = "downloads" | "likes" | "trending" | "lastModified" | "createdAt";

export interface HfSearchOptions {
  query: string;
  limit?: number;
  sort?: HfSort;
}

export interface HfSearchResult {
  ok: boolean;
  models: readonly HfModelSearchHit[];
  reason?: string;
}

function isJsonRecord(value: JsonValue): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toHfModelHit(item: JsonValue): HfModelSearchHit | undefined {
  if (!isJsonRecord(item)) {
    return undefined;
  }

  const id = typeof item.id === "string"
    ? item.id
    : typeof item.modelId === "string"
      ? item.modelId
      : "";
  if (id.length === 0) {
    return undefined;
  }

  const tagsValue = Array.isArray(item.tags) ? item.tags : [];
  const tags = tagsValue
    .map((tag) => (typeof tag === "string" ? tag : ""))
    .filter((tag) => tag.length > 0);

  return {
    id,
    downloads: typeof item.downloads === "number" ? item.downloads : 0,
    likes: typeof item.likes === "number" ? item.likes : 0,
    pipelineTag: typeof item.pipeline_tag === "string" ? item.pipeline_tag : undefined,
    lastModified: typeof item.lastModified === "string" ? item.lastModified : undefined,
    tags: tags.length > 0 ? tags : undefined,
  };
}

/**
 * Search HuggingFace Hub models via the public REST API.
 * Optionally uses `HF_TOKEN` env var for authenticated requests (higher rate limits).
 */
export async function searchHfModels(options: HfSearchOptions): Promise<HfSearchResult> {
  const { query, limit = DEFAULT_LIMIT, sort = "downloads" } = options;
  const clampedLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

  const url = new URL(HF_API_BASE);
  url.searchParams.set("search", query);
  url.searchParams.set("limit", String(clampedLimit));
  url.searchParams.set("sort", sort === "trending" ? "trending" : sort);
  url.searchParams.set("direction", "-1");

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  const token = process.env.HF_TOKEN || process.env.HUGGINGFACE_HUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const fetchResult = await fetch(url.toString(), {
    headers,
    signal: controller.signal,
  })
    .then((response) => ({
      ok: true as const,
      response,
    }), () => ({
      ok: false as const,
      reason: "HuggingFace API request failed.",
    }))
    .then((result) => {
      clearTimeout(timeout);
      return result;
    });

  if (!fetchResult.ok) {
    return {
      ok: false,
      models: [],
      reason: fetchResult.reason,
    };
  }

  const { response } = fetchResult;
  if (!response.ok) {
    return {
      ok: false,
      models: [],
      reason: `HuggingFace API returned ${response.status}: ${response.statusText}`,
    };
  }

  const payloadText = await response.text();
  const payload = safeParseJson<JsonValue[]>(payloadText);
  if (!payload.ok || !Array.isArray(payload.data)) {
    return {
      ok: false,
      models: [],
      reason: "HuggingFace API returned unexpected response shape",
    };
  }

  return {
    ok: true,
    models: payload.data
      .map((item) => toHfModelHit(item))
      .filter((item): item is HfModelSearchHit => item !== undefined),
  };
}
