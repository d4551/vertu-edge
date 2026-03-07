import type { AiWorkflowCapabilityResult, AiWorkflowMode } from "../../../contracts/flow-contracts";
import { getApiKey, getBaseUrl } from "../ai-keys";
import { getOllamaModelDetails, listOllamaModels } from "../ai-providers";
import { listLocalModels } from "../db";
import { OLLAMA_DEFAULT_BASE_URL, safeParseJson } from "../config";
import { t as tStr } from "../i18n";

const ORDERED_MODES: readonly AiWorkflowMode[] = ["chat", "typography", "presentation", "social", "image", "flow_generation"] as const;

type LocalCapabilityEvidence = {
  hasLocalModels: boolean;
  probeFailed: boolean;
};

// ---------------------------------------------------------------------------
// Pipeline tag → workflow mode mapping
// ---------------------------------------------------------------------------

/** Map HuggingFace pipeline tags to supported workflow modes. */
export function pipelineTagToModes(tag: string | null | undefined): AiWorkflowMode[] {
  if (!tag) return [];
  const normalized = tag.trim().toLowerCase();
  switch (normalized) {
    case "text-generation":
    case "text2text-generation":
      return ["chat", "typography", "presentation", "social", "flow_generation"];
    case "text-to-image":
      return ["image"];
    case "image-to-text":
    case "visual-question-answering":
      return ["chat"];
    default:
      return [];
  }
}

/** Map Ollama capability strings to supported workflow modes. */
export function ollamaCapabilitiesToModes(caps: string[]): AiWorkflowMode[] {
  const modes = new Set<AiWorkflowMode>();
  for (const cap of caps) {
    const lower = cap.toLowerCase();
    if (lower === "chat" || lower === "completion" || lower === "generate") {
      modes.add("chat");
      modes.add("typography");
      modes.add("presentation");
      modes.add("social");
      modes.add("flow_generation");
    }
    if (lower === "vision") {
      modes.add("chat");
    }
  }
  return [...modes];
}

/** Render the deterministic capability reason for the current local/remote evidence. */
function resolveCapabilityReason(
  localAvailable: boolean,
  remoteAvailable: boolean,
  evidence: LocalCapabilityEvidence,
): string | undefined {
  if (localAvailable) {
    return undefined;
  }

  if (evidence.probeFailed) {
    return remoteAvailable
      ? tStr("ai_workflow.capability_reason_probe_failed_remote")
      : tStr("ai_workflow.capability_reason_probe_failed");
  }

  if (evidence.hasLocalModels) {
    return remoteAvailable
      ? tStr("ai_workflow.capability_reason_local_missing_remote")
      : tStr("ai_workflow.capability_reason_local_missing");
  }

  return remoteAvailable
    ? undefined
    : tStr("ai_workflow.capability_reason_no_local_or_remote");
}

// ---------------------------------------------------------------------------
// Per-model capability resolution
// ---------------------------------------------------------------------------

/** Resolve current local/remote capability state for creative workflow modes. */
export async function resolveAiWorkflowCapabilities(correlationId?: string): Promise<AiWorkflowCapabilityResult> {
  // Track which modes have at least one local model available
  const localModeAvailability = new Map<AiWorkflowMode, boolean>();
  for (const mode of ORDERED_MODES) {
    localModeAvailability.set(mode, false);
  }
  const localEvidence: LocalCapabilityEvidence = {
    hasLocalModels: false,
    probeFailed: false,
  };

  // 1. Query Ollama models and interrogate each via /api/show
  const localBaseUrl = getBaseUrl("ollama") ?? OLLAMA_DEFAULT_BASE_URL;
  const ollamaResult = await listOllamaModels(localBaseUrl, correlationId);
  if (ollamaResult.ok && ollamaResult.data) {
    localEvidence.hasLocalModels = localEvidence.hasLocalModels || ollamaResult.data.length > 0;
    for (const modelName of ollamaResult.data) {
      const detailsResult = await getOllamaModelDetails(modelName, localBaseUrl, correlationId);
      if (!detailsResult.ok || !detailsResult.data) {
        localEvidence.probeFailed = true;
        continue;
      }

      const modes = ollamaCapabilitiesToModes(detailsResult.data.capabilities);
      for (const mode of modes) {
        localModeAvailability.set(mode, true);
      }
    }
  }

  // 2. Query local_models DB for registered models with pipeline tags
  const registeredModels = listLocalModels();
  localEvidence.hasLocalModels = localEvidence.hasLocalModels || registeredModels.length > 0;
  for (const model of registeredModels) {
    const modes = pipelineTagToModes(model.pipelineTag);
    for (const mode of modes) {
      localModeAvailability.set(mode, true);
    }

    // Also check JSON capabilities field if populated
    if (model.capabilities) {
      const parseResult = safeParseJson<string[]>(model.capabilities);
      if (parseResult.ok && Array.isArray(parseResult.data)) {
        const mappedModes = ollamaCapabilitiesToModes(parseResult.data);
        for (const mode of mappedModes) {
          localModeAvailability.set(mode, true);
        }
      }
    }
  }

  // 3. Remote availability: HF key present
  const remoteApiKey = getApiKey("huggingface") ?? "";
  const remoteAvailable = remoteApiKey.trim().length > 0;

  return {
    modes: ORDERED_MODES.map((mode) => {
      const localAvailable = localModeAvailability.get(mode) ?? false;
      const reason = resolveCapabilityReason(localAvailable, remoteAvailable, localEvidence);
      return {
        mode,
        localAvailable,
        remoteAvailable,
        ...(reason ? { reason } : {}),
      };
    }),
  };
}
