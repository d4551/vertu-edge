/**
 * AI Provider registry and unified OpenAI-compatible chat completion client.
 * Supports OpenAI, Anthropic, Google Gemini, Mistral, Groq, OpenRouter, and Ollama.
 */

import {
  PROVIDER_REGISTRY,
  OLLAMA_DEFAULT_BASE_URL,
  OPENROUTER_APP_TITLE,
  OPENROUTER_HTTP_REFERER,
  AI_CHAT_MAX_TOKENS,
  AI_PROVIDER_REQUEST_TIMEOUT_MS,
  AI_PROVIDER_LIST_REQUEST_ERROR,
  ANTHROPIC_API_VERSION,
  AI_PROVIDER_MODEL_LIST_ERROR,
  AI_PROVIDER_NO_FALLBACK_MODELS_ERROR,
  AI_PROVIDER_NO_MODELS_ERROR,
  AI_PROVIDER_OLLAMA_LIST_ERROR,
  OLLAMA_CHAT_COMPLETION_SUFFIX,
  OLLAMA_TAGS_PATH,
  OPENAI_CHAT_COMPLETION_SUFFIX,
  OPENAI_STT_SUFFIX,
  OPENAI_TTS_SUFFIX,
  OPENAI_TTS_DEFAULT_FORMAT,
  DEFAULT_CHAT_TTS_VOICE,
  type JsonRecord,
  type JsonValue,
  safeParseJson,
} from "./config";

/** Supported AI provider identifiers. */
export type ProviderId = string;

/** Chat message role. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Audio payload used for STT inputs and TTS responses. */
export interface AudioPayload {
  /** MIME type for the payload (for example `audio/wav`). */
  mimeType: string;
  /** Base64-encoded payload bytes. */
  data: string;
}

/** Result of speech-to-text conversion. */
export interface SpeechToTextResult {
  /** Transcribed text from the audio input. */
  transcript: string;
  /** Optional language hint from STT provider response. */
  language?: string;
}

/** Result of text-to-speech synthesis. */
export interface TextToSpeechResult {
  /** MIME type returned by the TTS provider. */
  mimeType: string;
  /** Base64-encoded audio output bytes. */
  data: string;
}

/** Metadata describing a single AI provider. */
export interface ProviderMeta {
  id: ProviderId;
  displayName: string;
  /** Base URL template — may include a trailing `/v1` path. */
  baseUrl: string;
  /** Whether an API key is required to use this provider. */
  requiresKey: boolean;
  /** Curated default model identifiers. */
  defaultModels: string[];
  /** Link to provider API docs. */
  docsUrl: string;
  /** Optional placeholder for API key input. */
  keyHint?: string;
  /** If true, show base URL config input. */
  hasBaseUrlConfig?: boolean;
}

/** Provider model list envelope for UI/model discovery paths. */
export interface ProviderModelListEnvelope {
  /** Provider identifier used by the model discovery request. */
  provider: ProviderId;
  /** Human-readable provider name. */
  displayName: string;
  /** Model identifiers returned by the provider or fallback defaults. */
  models: string[];
  /** Indicates whether models came from remote API or configuration defaults. */
  source: "remote" | "fallback";
  /** Optional error detail from remote discovery. */
  error?: string;
}

const OPENAI_MODELS_SUFFIX = "/models";

/** Dynamic provider registry loaded from runtime configuration. */
export const PROVIDERS: readonly ProviderMeta[] = PROVIDER_REGISTRY.map((provider) => ({
  id: provider.id,
  displayName: provider.displayName,
  baseUrl: provider.baseUrl,
  requiresKey: provider.requiresKey,
  defaultModels: [...provider.defaultModels],
  docsUrl: provider.docsUrl,
  ...(provider.keyHint ? { keyHint: provider.keyHint } : {}),
  ...(provider.hasBaseUrlConfig ? { hasBaseUrlConfig: provider.hasBaseUrlConfig } : {}),
}));

/** Registry helper used by UI and service layers. */
export function getProviderCatalog(): readonly ProviderMeta[] {
  return PROVIDERS;
}

/** Retrieve provider metadata by ID. */
export function getProvider(id: ProviderId): ProviderMeta | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** Parse and validate provider ID against the registry. Returns null for unknown providers. */
export function parseProviderId(raw: string | null | undefined): ProviderId | null {
  if (raw == null || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const found = PROVIDERS.find((p) => p.id === trimmed);
  return found ? found.id : null;
}

/** Return a deduplicated list of model options across providers. */
export function getProviderModelOptions(): string[] {
  const seen = new Set<string>();
  return PROVIDERS.flatMap((provider) => provider.defaultModels)
    .filter((model) => model.length > 0)
    .filter((model) => {
      if (seen.has(model)) return false;
      seen.add(model);
      return true;
    });
}

/** Return model options for one provider. */
export function getProviderModelOptionsForProvider(providerId: ProviderId): string[] {
  const provider = getProvider(providerId);
  return provider?.defaultModels ?? [];
}

/** Return the first default model for a provider id, when available. */
export function getProviderDefaultModel(providerId: string): string | undefined {
  const provider = getProvider(providerId);
  return provider?.defaultModels.at(0);
}

/** Result envelope for AI operations. */
export interface AiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** Trim trailing separators from configured base URLs. */
function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/** Rewrite localhost to 127.0.0.1 to avoid IPv6 resolution issues (::1) when the service listens on IPv4 only. */
function ensureLocalhostIPv4(url: string): string {
  const trimmed = url.trim();
  return trimmed.replace(/^https?:\/\/localhost(\b|:)/i, (match) => match.replace(/localhost/i, "127.0.0.1"));
}

function openAICompatibleEndpointCandidates(
  providerId: ProviderId,
  baseUrl: string,
  suffix: string,
): readonly string[] {
  const normalized = ensureLocalhostIPv4(normalizeBaseUrl(baseUrl));
  const primary = `${normalized}${suffix}`;
  if (providerId === "huggingface" && !normalized.toLowerCase().endsWith("/v1")) {
    return [primary, `${normalized}/v1${suffix}`];
  }
  return [primary];
}

async function fetchJsonWithEndpointFallback<T extends JsonValue>(
  endpoints: readonly string[],
  options: RequestInit,
): Promise<AiResult<T>> {
  let lastError: string | undefined;
  for (const endpoint of endpoints) {
    const response = await fetchJsonWithTimeout<T>(endpoint, options);
    if (response.ok) {
      return response;
    }
    lastError = response.error;
  }
  return { ok: false, error: lastError ?? AI_PROVIDER_MODEL_LIST_ERROR };
}

async function fetchResponseWithEndpointFallback(
  endpoints: readonly string[],
  options: RequestInit,
): Promise<{ ok: true; response: Response } | { ok: false; error: string }> {
  let lastError: string | undefined;
  for (const endpoint of endpoints) {
    const response = await fetchWithTimeout(endpoint, options);
    if (response.ok) {
      return { ok: true, response };
    }

    const body = await response.text();
    lastError = `${response.status}: ${body}`;
  }
  return { ok: false, error: lastError ?? "Provider chat request failed." };
}

function listRequestHeaders(providerId: ProviderId, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (providerId !== "ollama" && providerId !== "anthropic") {
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
  }

  if (providerId === "anthropic") {
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }
    headers["anthropic-version"] = ANTHROPIC_API_VERSION;
  }

  if (providerId === "openrouter") {
    headers["HTTP-Referer"] = OPENROUTER_HTTP_REFERER;
    headers["X-Title"] = OPENROUTER_APP_TITLE;
  }

  return headers;
}

function audioRequestHeaders(providerId: ProviderId, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (providerId !== "ollama" && providerId !== "anthropic" && apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  if (providerId === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = ANTHROPIC_API_VERSION;
  }
  if (providerId === "openrouter") {
    headers["HTTP-Referer"] = OPENROUTER_HTTP_REFERER;
    headers["X-Title"] = OPENROUTER_APP_TITLE;
  }
  return headers;
}

function isAudioProvider(providerId: ProviderId): boolean {
  return providerId !== "anthropic";
}

function normalizeBase64Data(value: string): string {
  return value.trim().replace(/\s+/g, "");
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

function decodeBase64Payload(payload: string): AiResult<Uint8Array> {
  const normalized = normalizeBase64Data(payload);
  if (!normalized.length) {
    return { ok: false, error: "speechInput data cannot be empty." };
  }
  const parsed = safeDecodeBase64(normalized);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  return parsed;
}

function safeDecodeBase64(payload: string): AiResult<Uint8Array> {
  if (!BASE64_PATTERN.test(payload)) {
    return { ok: false, error: "Unable to decode speechInput payload." };
  }

  const paddedLength = payload.length % 4;
  const paddedPayload = paddedLength === 0
    ? payload
    : `${payload}${"=".repeat(4 - paddedLength)}`;
  const decodedBinary = atob(paddedPayload);
  const bytes = Uint8Array.from(decodedBinary, (character) => character.charCodeAt(0));
  return { ok: true, data: bytes };
}

function dedupeModelList(models: readonly string[]): string[] {
  const seen = new Set<string>();
  return models
    .map((model) => model.trim())
    .filter((model) => model.length > 0)
    .filter((model) => {
      const key = model.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Type guard for plain objects (not null, not array). */
function isRecord(value: JsonValue | undefined): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Extract trimmed string from JsonValue for API response fields. */
function jsonValueToString(value: JsonValue | undefined): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return value.toString().trim();
  return "";
}

/** Extract model identifiers from API response shapes: string or array of strings/objects. */
function collectModelsFromRecords(value: string | JsonValue[]): string[] {
  if (typeof value === "string") {
    return dedupeModelList([value]);
  }
  if (!Array.isArray(value)) {
    return [];
  }

  return dedupeModelList(value.map((item) => {
    if (typeof item === "string") return item;
    if (!isRecord(item)) return "";
    const candidate = item.id ?? item.model ?? item.name;
    return typeof candidate === "string" ? candidate : "";
  }).filter((v) => v.length > 0));
}

function parseProviderModelListPayload(payload: JsonValue): string[] {
  if (payload === null || payload === undefined) return [];
  if (Array.isArray(payload)) return collectModelsFromRecords(payload);
  if (isRecord(payload)) {
    const fromData = Array.isArray(payload.data) ? collectModelsFromRecords(payload.data) : [];
    if (fromData.length > 0) return fromData;
    const fromModels = Array.isArray(payload.models) ? collectModelsFromRecords(payload.models) : [];
    if (fromModels.length > 0) return fromModels;
  }
  return [];
}

async function fetchJsonWithTimeout<T extends JsonValue>(
  url: string,
  options: RequestInit = {},
): Promise<AiResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, AI_PROVIDER_REQUEST_TIMEOUT_MS);

  const fetchResult = await fetchWithResult(url, { ...options, signal: controller.signal });
  clearTimeout(timeout);

  if (!fetchResult.ok) {
    if (fetchResult.aborted) {
      return { ok: false, error: `Model list request timed out after ${AI_PROVIDER_REQUEST_TIMEOUT_MS}ms.` };
    }
    return { ok: false, error: fetchResult.error };
  }

  const parseResult = safeParseJson<T>(fetchResult.body);
  if (!parseResult.ok) {
    return { ok: false, error: parseResult.error };
  }
  return { ok: true, data: parseResult.data };
}

type FetchFailure =
  | Error
  | { name?: string; message?: string }
  | string
  | number
  | boolean
  | null
  | undefined;

type FetchResult =
  | { ok: true; body: string }
  | { ok: false; error: string; aborted?: boolean };

async function fetchWithResult(url: string, init: RequestInit): Promise<FetchResult> {
  const outcome = await fetchWithResultImpl(url, init);
  if (outcome.success) return { ok: true, body: outcome.body };
  return {
    ok: false,
    error: outcome.error,
    aborted: outcome.aborted,
  };
}

async function fetchWithResultImpl(
  url: string,
  init: RequestInit,
): Promise<{ success: true; body: string } | { success: false; error: string; aborted?: boolean }> {
  const fetchOutcome = await fetch(url, init).then(
    (response) => ({ ok: true as const, response }),
    (failure: FetchFailure) => ({ ok: false as const, failure }),
  );
  if (!fetchOutcome.ok) {
    return {
      success: false,
      error: fetchFailureMessage(fetchOutcome.failure),
      aborted: isAbortFailure(fetchOutcome.failure),
    };
  }
  const response = fetchOutcome.response;

  if (!response.ok) {
    const body = await response.text();
    return { success: false, error: `${response.status}: ${body}` };
  }

  const body = await response.text();
  return { success: true, body };
}

function isAbortFailure(failure: FetchFailure): boolean {
  if (failure instanceof Error) {
    return failure.name === "AbortError";
  }
  if (typeof failure === "object" && failure !== null && "name" in failure) {
    return failure.name === "AbortError";
  }
  return false;
}

function fetchFailureMessage(failure: FetchFailure): string {
  if (failure instanceof Error) {
    return failure.message;
  }
  if (typeof failure === "string") {
    return failure;
  }
  if (typeof failure === "number" || typeof failure === "boolean") {
    return String(failure);
  }
  if (typeof failure === "object" && failure !== null && "message" in failure && typeof failure.message === "string") {
    return failure.message;
  }
  return AI_PROVIDER_LIST_REQUEST_ERROR;
}

/**
 * List remote models for a provider.
 * Returns an error when the provider does not support listing or cannot be queried.
 */
export async function listProviderModels(
  providerId: ProviderId,
  apiKey: string,
  baseUrlOverride?: string,
): Promise<AiResult<ProviderModelListEnvelope>> {
  const provider = getProvider(providerId);
  if (!provider) return { ok: false, error: `Unknown provider: ${providerId}` };

  const configuredBaseUrl = ensureLocalhostIPv4((baseUrlOverride ?? provider.baseUrl).trim());
  if (!configuredBaseUrl.length) {
    return { ok: false, error: `Provider ${provider.displayName} has no base URL configured.` };
  }

  if (provider.requiresKey && !apiKey.length) {
    return {
      ok: false,
      error: `${provider.displayName} requires an API key to list available models.`,
    };
  }

  if (providerId === "ollama") {
    const ollamaResponse = await listOllamaModels(configuredBaseUrl);
    if (!ollamaResponse.ok || !ollamaResponse.data) {
      return { ok: false, error: ollamaResponse.error ?? AI_PROVIDER_OLLAMA_LIST_ERROR };
    }
    return {
      ok: true,
      data: {
        provider: provider.id,
        displayName: provider.displayName,
        models: dedupeModelList(ollamaResponse.data),
        source: "remote",
      },
    };
  }

  const modelEndpoints = openAICompatibleEndpointCandidates(providerId, configuredBaseUrl, OPENAI_MODELS_SUFFIX);
  const response = await fetchJsonWithEndpointFallback<JsonRecord | JsonValue[]>(modelEndpoints, {
    method: "GET",
    headers: listRequestHeaders(providerId, apiKey),
  });

  if (!response.ok || !response.data) {
    return {
      ok: false,
      error: response.error ?? AI_PROVIDER_MODEL_LIST_ERROR,
    };
  }

  const discovered = parseProviderModelListPayload(response.data);
  if (discovered.length === 0) {
    return { ok: false, error: AI_PROVIDER_NO_MODELS_ERROR };
  }

  return {
    ok: true,
    data: {
      provider: provider.id,
      displayName: provider.displayName,
      models: dedupeModelList(discovered),
      source: "remote",
    },
  };
}

/** List provider models and fallback to configured defaults when discovery is unavailable. */
export async function listProviderModelsOrDefaults(
  providerId: ProviderId,
  apiKey: string,
  baseUrlOverride?: string,
): Promise<AiResult<ProviderModelListEnvelope>> {
  const provider = getProvider(providerId);
  if (!provider) return { ok: false, error: `Unknown provider: ${providerId}` };

  const remote = await listProviderModels(providerId, apiKey, baseUrlOverride);
  if (remote.ok && remote.data) {
    return remote;
  }

  const fallbackModels = getProviderModelOptionsForProvider(providerId);
  if (fallbackModels.length > 0) {
    return {
      ok: true,
      data: {
        provider: provider.id,
        displayName: provider.displayName,
        models: dedupeModelList(fallbackModels),
        source: "fallback",
        error: remote.error,
      },
    };
  }

  return { ok: false, error: remote.error ?? AI_PROVIDER_NO_FALLBACK_MODELS_ERROR };
}

/**
 * Send a chat completion request to any supported provider.
 * All providers except Anthropic use the OpenAI-compatible `/chat/completions` format.
 */
export async function chatCompletion(
  providerId: ProviderId,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  baseUrlOverride?: string,
): Promise<AiResult<string>> {
  const provider = getProvider(providerId);
  if (!provider) return { ok: false, error: `Unknown provider: ${providerId}` };

  const baseUrl = baseUrlOverride ?? provider.baseUrl;

  if (providerId === "anthropic") {
    return anthropicChat(baseUrl, apiKey, model, messages);
  }

  return openaiCompatibleChat(baseUrl, apiKey, model, messages, providerId);
}

/**
 * Convert speech input to text using provider-native transcription APIs.
 */
export async function transcribeSpeech(
  providerId: ProviderId,
  apiKey: string,
  model: string,
  speechInput: AudioPayload,
  baseUrlOverride?: string,
): Promise<AiResult<SpeechToTextResult>> {
  const provider = getProvider(providerId);
  if (!provider) return { ok: false, error: `Unknown provider: ${providerId}` };
  if (!isAudioProvider(providerId)) {
    return { ok: false, error: `${provider.displayName} does not support cloud STT endpoints.` };
  }

  const decoded = decodeBase64Payload(speechInput.data);
  if (!decoded.ok) {
    return { ok: false, error: decoded.error };
  }
  if (!decoded.data) {
    return { ok: false, error: "Failed to decode speech input payload." };
  }
  const decodedBytes = decoded.data;

  const normalizedBase = ensureLocalhostIPv4(normalizeBaseUrl(baseUrlOverride ?? provider.baseUrl));
  const endpoints = openAICompatibleEndpointCandidates(providerId, normalizedBase, OPENAI_STT_SUFFIX);

  const formData = new FormData();
  formData.append("model", model);
  formData.append("file", new Blob([decodedBytes], { type: speechInput.mimeType }), "speech-input");
  formData.append("response_format", "json");

  const headers = audioRequestHeaders(providerId, apiKey);
  const response = await fetchResponseWithEndpointFallback(endpoints, {
    method: "POST",
    headers,
    body: formData,
  });
  if (!response.ok) {
    return { ok: false, error: response.error };
  }

  const body = await response.response.text();
  const parseResult = safeParseJson<JsonRecord>(body);
  if (!parseResult.ok) {
    return { ok: false, error: parseResult.error };
  }
  const json = parseResult.data;
  if (typeof json.text === "string") {
    const transcript = json.text.trim();
    if (transcript.length > 0) {
      return { ok: true, data: { transcript } };
    }
  }
  return { ok: false, error: `STT provider response was missing transcript data: ${body}` };
}

/**
 * Convert assistant reply text to speech using provider-native TTS APIs.
 */
export async function synthesizeSpeech(
  providerId: ProviderId,
  apiKey: string,
  model: string,
  inputText: string,
  outputMimeType: string,
  ttsVoice: string | undefined,
  baseUrlOverride?: string,
): Promise<AiResult<TextToSpeechResult>> {
  const provider = getProvider(providerId);
  if (!provider) return { ok: false, error: `Unknown provider: ${providerId}` };
  if (!isAudioProvider(providerId)) {
    return { ok: false, error: `${provider.displayName} does not support cloud TTS endpoints.` };
  }

  const normalizedBase = ensureLocalhostIPv4(normalizeBaseUrl(baseUrlOverride ?? provider.baseUrl));
  const endpoints = openAICompatibleEndpointCandidates(providerId, normalizedBase, OPENAI_TTS_SUFFIX);
  const headers = audioRequestHeaders(providerId, apiKey);
  const normalizedOutputMimeType = outputMimeType.trim();
  const normalizedVoice = ttsVoice?.trim().length ? ttsVoice.trim() : DEFAULT_CHAT_TTS_VOICE;

  const ttsRequest = {
    model,
    input: inputText,
    response_format: normalizedOutputMimeType || OPENAI_TTS_DEFAULT_FORMAT,
    voice: normalizedVoice,
  };

  const response = await fetchResponseWithEndpointFallback(endpoints, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(ttsRequest),
  });
  if (!response.ok) {
    return { ok: false, error: response.error };
  }

  const arrayBuffer = await response.response.arrayBuffer();
  const base64Audio = Buffer.from(arrayBuffer).toString("base64");
  return { ok: true, data: { mimeType: outputMimeType, data: base64Audio } };
}

/**
 * OpenAI-compatible chat completion.
 * Works for OpenAI, Google Gemini, Mistral, Groq, OpenRouter, and Ollama.
 */
async function openaiCompatibleChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  providerId: ProviderId,
): Promise<AiResult<string>> {
  const normalizedBase = ensureLocalhostIPv4(normalizeBaseUrl(baseUrl));
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  if (providerId === "openrouter") {
    headers["HTTP-Referer"] = OPENROUTER_HTTP_REFERER;
    headers["X-Title"] = OPENROUTER_APP_TITLE;
  }

  const endpoints = providerId === "ollama"
    ? [`${normalizedBase}${OLLAMA_CHAT_COMPLETION_SUFFIX}`]
    : openAICompatibleEndpointCandidates(providerId, normalizedBase, OPENAI_CHAT_COMPLETION_SUFFIX);
  const response = await fetchResponseWithEndpointFallback(endpoints, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages, max_tokens: AI_CHAT_MAX_TOKENS }),
  });
  if (!response.ok) {
    return { ok: false, error: response.error };
  }

  const body = await response.response.text();
  const parseResult = safeParseJson<JsonRecord>(body);
  if (!parseResult.ok) {
    return { ok: false, error: parseResult.error };
  }
  const json = parseResult.data;
  const choices = Array.isArray(json.choices) ? json.choices : undefined;
  const firstChoice = choices?.[0];
  const msgObj = isRecord(firstChoice) ? firstChoice.message : undefined;
  const message = isRecord(msgObj) && typeof msgObj.content === "string"
    ? msgObj.content
    : undefined;
  const content = typeof message === "string" ? message : undefined;
  return content
    ? { ok: true, data: content }
    : { ok: false, error: "No content in response" };
}

/**
 * Anthropic Messages API adapter.
 * Anthropic uses a different request/response format from the OpenAI standard.
 */
async function anthropicChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
): Promise<AiResult<string>> {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const systemMsg = messages.find((m) => m.role === "system");
  const nonSystemMessages = messages
    .filter((m): m is { role: "user" | "assistant"; content: string } => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  const body: {
    model: string;
    max_tokens: number;
    messages: { role: "user" | "assistant"; content: string }[];
    system?: string;
  } = {
    model,
    max_tokens: AI_CHAT_MAX_TOKENS,
    messages: nonSystemMessages,
  };

  if (systemMsg) {
    body.system = systemMsg.content;
  }

  const response = await fetchWithTimeout(`${normalizedBase}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errBody = await response.text();
    return { ok: false, error: `${response.status}: ${errBody}` };
  }

  const responseText = await response.text();
  const parseResult = safeParseJson<JsonRecord>(responseText);
  if (!parseResult.ok) {
    return { ok: false, error: parseResult.error };
  }
  const json = parseResult.data;
  const contentArr = Array.isArray(json.content) ? json.content : undefined;
  const textBlock = contentArr?.find((b): b is JsonRecord => isRecord(b) && b.type === "text");
  const text = textBlock != null && typeof textBlock.text === "string"
    ? textBlock.text
    : undefined;
  return text
    ? { ok: true, data: text }
    : { ok: false, error: "No text content in Anthropic response" };
}

/**
 * List locally-available Ollama models via the `/api/tags` endpoint.
 */
export async function listOllamaModels(
  baseUrl: string = OLLAMA_DEFAULT_BASE_URL,
): Promise<AiResult<string[]>> {
  const normalizedBase = ensureLocalhostIPv4(normalizeBaseUrl(baseUrl));
  const response = await fetchWithTimeout(`${normalizedBase}${OLLAMA_TAGS_PATH}`);

  if (!response.ok) {
    const body = await response.text();
    return { ok: false, error: `Ollama unreachable: ${response.status} ${body}` };
  }

  const body = await response.text();
  const parseResult = safeParseJson<JsonRecord>(body);
  if (!parseResult.ok) {
    return { ok: false, error: parseResult.error };
  }
  const json = parseResult.data;
  const modelsArr = Array.isArray(json.models) ? json.models : [];
  const names = dedupeModelList(modelsArr
    .filter((m): m is JsonRecord => isRecord(m))
    .map((m) => jsonValueToString(m.name))
    .filter((n) => n.length > 0));
  return { ok: true, data: names };
}

/**
 * Test connectivity to a provider by listing available models.
 * Uses provider-specific list endpoints (e.g. Ollama /api/tags, OpenAI /models)
 * instead of hardcoded chat completions, so no specific model must exist.
 */
export async function testConnection(
  providerId: ProviderId,
  apiKey: string,
  baseUrlOverride?: string,
): Promise<AiResult<string>> {
  const provider = getProvider(providerId);
  if (!provider) return { ok: false, error: `Unknown provider: ${providerId}` };

  const result = await listProviderModels(providerId, apiKey, baseUrlOverride);
  return result.ok ? { ok: true, data: "ok" } : { ok: false, error: result.error };
}

async function fetchWithTimeout(input: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_PROVIDER_REQUEST_TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timeout);
  });
}
