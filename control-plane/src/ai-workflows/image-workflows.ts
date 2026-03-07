import type { AiResult, ProviderId, ProviderImageGenerationOptions } from "../ai-providers";
import { generateImage, listProviderModelsOrDefaults } from "../ai-providers";
import { getApiKey, getBaseUrl } from "../ai-keys";
import { AI_WORKFLOW_HF_IMAGE_MODEL, AI_WORKFLOW_LOCAL_IMAGE_MODEL, OLLAMA_DEFAULT_BASE_URL } from "../config";

/** Image generation output with provider path context. */
export interface ImageWorkflowOutput {
  /** Provider path used for successful execution. */
  providerPath: string;
  /** Model identifier used for generation. */
  model: string;
  /** MIME type of generated payload. */
  mimeType: string;
  /** Base64-encoded image payload. */
  data: string;
  /** Optional detail lines describing fallback decisions. */
  details: string[];
}

/** Inputs for local-first image generation orchestration. */
export interface RunImageWorkflowInput {
  /** Prompt text used for image generation. */
  message: string;
  /** Optional model override requested by operator. */
  requestedModel?: string;
  /** Optional image tuning options. */
  options?: ProviderImageGenerationOptions;
  /** Optional correlation id for provider requests. */
  correlationId?: string;
}

/** Execute image generation with local Ollama-first and Hugging Face fallback. */
export async function runImageWorkflowLocalFirst(input: RunImageWorkflowInput): Promise<AiResult<ImageWorkflowOutput>> {
  const details: string[] = [];
  const localBaseUrl = getBaseUrl("ollama") ?? OLLAMA_DEFAULT_BASE_URL;
  const requestedModel = input.requestedModel?.trim();
  const localModel = await resolveLocalImageModel(requestedModel, localBaseUrl, input.correlationId);
  if (localModel) {
    const localResult = await generateImage(
      "ollama",
      "",
      localModel,
      input.message,
      input.options,
      localBaseUrl,
      input.correlationId,
    );
    if (localResult.ok && localResult.data) {
      return {
        ok: true,
        data: {
          providerPath: "local:ollama",
          model: localModel,
          mimeType: localResult.data.mimeType,
          data: localResult.data.data,
          details,
        },
      };
    }
    details.push(`Local Ollama image generation failed: ${localResult.error ?? "unknown error"}`);
  } else {
    details.push("No local Ollama image model is available.");
  }

  const huggingFaceKey = getApiKey("huggingface") ?? "";
  if (!huggingFaceKey.trim().length) {
    return {
      ok: false,
      error: "Missing Hugging Face API key for remote image fallback.",
    };
  }
  const remoteModel = requestedModel || AI_WORKFLOW_HF_IMAGE_MODEL;
  const remoteResult = await generateImage(
    "huggingface",
    huggingFaceKey,
    remoteModel,
    input.message,
    input.options,
    getBaseUrl("huggingface") ?? undefined,
    input.correlationId,
  );
  if (!remoteResult.ok || !remoteResult.data) {
    return {
      ok: false,
      error: remoteResult.error ?? "Remote Hugging Face image generation failed.",
    };
  }
  details.push("Used remote Hugging Face fallback image generation.");
  return {
    ok: true,
    data: {
      providerPath: "remote:huggingface",
      model: remoteModel,
      mimeType: remoteResult.data.mimeType,
      data: remoteResult.data.data,
      details,
    },
  };
}

async function resolveLocalImageModel(
  requestedModel: string | undefined,
  baseUrl: string,
  correlationId?: string,
): Promise<string | null> {
  if (requestedModel && requestedModel.length > 0) {
    return requestedModel;
  }
  const listed = await listProviderModelsOrDefaults("ollama", "", baseUrl, correlationId);
  if (listed.ok && listed.data && listed.data.models.length > 0) {
    return listed.data.models[0] ?? AI_WORKFLOW_LOCAL_IMAGE_MODEL;
  }
  return AI_WORKFLOW_LOCAL_IMAGE_MODEL || null;
}

/** Runtime guard for provider ids supported by image generation adapter. */
export function isImageProvider(providerId: ProviderId): boolean {
  return providerId === "ollama" || providerId === "huggingface";
}
