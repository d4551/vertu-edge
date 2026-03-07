import type {
  FlowAutomationValidationResult,
  FlowCapabilityError,
  FlowCommand,
  FlowRunTarget,
} from "../../contracts/flow-contracts";
import { createFlowCapabilityError, isFlowCommandType } from "../../contracts/flow-contracts";
import { DEFAULT_FLOW_TARGET, type JsonRecord, type JsonValue } from "./config";
import { getFlowTargetCapabilityProbe } from "./flow-engine";

/** Parsed YAML scalar/object/array shape allowed for automation-analysis inputs. */
export type ParsedFlowYamlValue = string | number | boolean | null | ParsedFlowYamlObject | ParsedFlowYamlValue[];

/** Parsed YAML object shape used by flow automation analysis. */
export type ParsedFlowYamlObject = {
  [key: string]: ParsedFlowYamlValue;
};

/** Per-step automation analysis result used by validation and tests. */
export type AutomationStepAnalysis = {
  index: number;
  commandType: string;
  supported: boolean;
  reason?: string;
};

/** Output of compatibility analysis for flow-automation validation requests. */
export interface FlowAutomationCompatibilityResult {
  /** Render-safe validation data. */
  readonly data: FlowAutomationValidationResult;
  /** Human-readable mismatch summary. */
  readonly mismatches: string[];
  /** Optional target-readiness failure from the platform probe. */
  readonly targetReadinessFailure?: FlowCapabilityError | null;
}

function isPlainRecord(value: JsonValue): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isParsedFlowYamlObject(value: JsonValue): value is ParsedFlowYamlObject {
  return isPlainRecord(value);
}

function isParsedFlowYamlValue(value: JsonValue): value is ParsedFlowYamlValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((entry) => isParsedFlowYamlValue(entry));
  }
  if (isPlainRecord(value)) {
    return Object.values(value).every((entry) => isParsedFlowYamlValue(entry));
  }
  return false;
}

/** Type guard for registry-backed flow command identifiers. */
export function isKnownFlowCommandType(commandType: string): commandType is FlowCommand["type"] {
  return isFlowCommandType(commandType);
}

/** Analyze parsed YAML flow automation compatibility against a target probe. */
export async function analyzeFlowAutomationCompatibility(
  rawYaml: string,
  target: FlowRunTarget = DEFAULT_FLOW_TARGET,
): Promise<FlowAutomationCompatibilityResult> {
  const { appId, steps } = parseFlowForAutomation(rawYaml);
  const capabilityProbe = getFlowTargetCapabilityProbe(target);
  const readinessFailure = await capabilityProbe.validateTargetReady();

  const analyzed = steps.map((step, index) => {
    const stepAnalysis = analyzeAutomationStep(step, index);
    if (!stepAnalysis.supported) {
      return stepAnalysis;
    }

    if (readinessFailure) {
      return {
        ...stepAnalysis,
        supported: false,
        reason: readinessFailure.reason,
      };
    }

    if (isKnownFlowCommandType(stepAnalysis.commandType) && !capabilityProbe.supportsCommand(stepAnalysis.commandType)) {
      return {
        ...stepAnalysis,
        supported: false,
        reason: `${stepAnalysis.commandType} is not supported on ${capabilityProbe.target} target.`,
      };
    }

    return stepAnalysis;
  });

  const supportedCommandCount = analyzed.filter((step) => step.supported).length;
  const mismatchSet = new Set<string>();
  for (const step of analyzed) {
    if (!step.supported && step.reason) {
      mismatchSet.add(`Unsupported step ${step.index + 1}: ${step.commandType}${step.reason ? ` — ${step.reason}` : ""}`);
    }
  }
  if (readinessFailure) {
    mismatchSet.add(`Target readiness check failed: ${readinessFailure.reason}`);
  }

  return {
    data: {
      appId,
      commandCount: analyzed.length,
      supportedCommandCount,
      steps: analyzed.map((item) => ({
        index: item.index,
        commandType: item.commandType,
        supported: item.supported,
        reason: item.reason,
      })),
    },
    mismatches: [...mismatchSet],
    targetReadinessFailure: readinessFailure,
  };
}

/** Parse flow YAML into canonical appId + step documents for automation analysis. */
export function parseFlowForAutomation(rawYaml: string): { appId: string; steps: ParsedFlowYamlValue[] } {
  const documents = splitFlowYamlDocuments(rawYaml);
  if (documents.length === 1) {
    const rootDocument = documents.at(0);
    if (rootDocument === undefined) {
      throw createFlowCapabilityError({
        commandIndex: -1,
        command: "flow",
        reason: "Flow YAML must include a single document or config+commands documents only.",
        retryable: false,
        surface: "flow_automation",
      });
    }
    const root = asFlowRecord(rootDocument, "Flow YAML must be an object.");
    const appId = asFlowText(root.appId, "Flow YAML config must include appId.");
    const steps = asFlowArray(root.steps, "Flow steps must be an array.");
    return { appId, steps };
  }

  if (documents.length === 2) {
    const configDocument = documents.at(0);
    if (configDocument === undefined) {
      throw createFlowCapabilityError({
        commandIndex: -1,
        command: "flow",
        reason: "Flow YAML config document is missing.",
        retryable: false,
        surface: "flow_automation",
      });
    }
    const config = asFlowRecord(configDocument, "Flow YAML config document must be an object.");
    const appId = asFlowText(config.appId, "Flow YAML config document must define appId.");
    const stepsDocument = documents.at(1);
    if (stepsDocument === undefined) {
      throw createFlowCapabilityError({
        commandIndex: -1,
        command: "flow",
        reason: "Flow YAML second document is missing.",
        retryable: false,
        surface: "flow_automation",
      });
    }
    const steps = asFlowArray(stepsDocument, "Flow YAML second document must be an array of steps.");
    return { appId, steps };
  }

  throw createFlowCapabilityError({
    commandIndex: -1,
    command: "flow",
    reason: "Flow YAML must include a single document or config+commands documents only.",
    retryable: false,
    surface: "flow_automation",
  });
}

/** Split YAML into validated documents using Bun's native YAML parser. */
export function splitFlowYamlDocuments(rawYaml: string): ParsedFlowYamlValue[] {
  const source = rawYaml.replace(/\r\n/g, "\n").trim();
  if (source.length === 0) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "flow",
      reason: "Flow payload is empty.",
      retryable: false,
      surface: "flow_automation",
    });
  }

  const docs: string[] = [];
  let current: string[] = [];

  for (const line of source.split("\n")) {
    if (line.trim() === "---") {
      if (current.length > 0) {
        docs.push(current.join("\n"));
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) {
    docs.push(current.join("\n"));
  }

  return docs.map((doc) => {
    const parsed = Bun.YAML.parse(doc) as JsonValue | undefined;
    if (parsed === undefined) {
      throw createFlowCapabilityError({
        commandIndex: -1,
        command: "flow",
        reason: "Flow YAML document is invalid.",
        retryable: false,
        surface: "flow_automation",
      });
    }
    if (!isParsedFlowYamlValue(parsed)) {
      throw createFlowCapabilityError({
        commandIndex: -1,
        command: "flow",
        reason: "Flow YAML document is malformed.",
        retryable: false,
        surface: "flow_automation",
      });
    }
    return parsed;
  });
}

/** Analyze one flow step for syntax and command-shape compatibility. */
export function analyzeAutomationStep(step: ParsedFlowYamlValue, index: number): AutomationStepAnalysis {
  if (typeof step === "string") {
    const commandType = step.trim();
    if (commandType.length === 0) {
      return { index, commandType: "empty-step", supported: false, reason: "Scalar command must not be empty." };
    }
    if (isFlowCommandType(commandType)) {
      return validateScalarAutomationCommand(commandType, undefined, index);
    }
    return { index, commandType, supported: false, reason: "Unknown scalar command." };
  }

  if (typeof step === "number" || typeof step === "boolean" || step === null) {
    return { index, commandType: "invalid", supported: false, reason: "Flow step must be a mapping or scalar command." };
  }

  if (Array.isArray(step)) {
    return { index, commandType: "array", supported: false, reason: "Flow step cannot be an array." };
  }

  if (!isParsedFlowYamlObject(step)) {
    return { index, commandType: "invalid", supported: false, reason: "Flow step must be a mapping or scalar command." };
  }

  const rawStep = step;
  if (typeof rawStep.type !== "undefined") {
    if (typeof rawStep.type !== "string") {
      return { index, commandType: String(rawStep.type), supported: false, reason: "Command type must be a string." };
    }

    const commandType = rawStep.type.trim();
    if (commandType.length === 0) {
      return { index, commandType: "empty-type", supported: false, reason: "Command type must not be empty." };
    }

    if (!isFlowCommandType(commandType)) {
      return { index, commandType, supported: false, reason: "Unsupported command type." };
    }
    return validateObjectAutomationCommand(commandType, rawStep, index);
  }

  const keys = Object.keys(rawStep);
  if (keys.length !== 1) {
    return { index, commandType: "object", supported: false, reason: "Maestro object command must contain exactly one command key." };
  }

  const [key] = keys;
  if (!key) {
    return { index, commandType: "empty-command", supported: false, reason: "Step object is missing a command key." };
  }

  if (!isFlowCommandType(key)) {
    return { index, commandType: key, supported: false, reason: "Unsupported command key." };
  }

  return validateScalarAutomationCommand(key, rawStep[key], index);
}

/** Validate a scalar Maestro-style command shape. */
export function validateScalarAutomationCommand(
  commandType: string,
  value: ParsedFlowYamlValue | undefined,
  index: number,
): AutomationStepAnalysis {
  switch (commandType) {
    case "launchApp":
    case "hideKeyboard":
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return { index, commandType, supported: false, reason: `${commandType} does not accept a scalar value.` };
      }
      return { index, commandType, supported: true };
    case "assertNotVisible":
    case "assertVisible":
      if (typeof value !== "string" || value.trim().length === 0) {
        return { index, commandType, supported: false, reason: `${commandType} requires a non-empty target string.` };
      }
      return { index, commandType, supported: true };
    case "tapOn":
      if (typeof value === "string" && value.trim().length > 0) {
        return { index, commandType, supported: true };
      }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const selectorKeys = ["text", "resourceId", "contentDescription"];
        const hasKnownSelector = selectorKeys.some((key) => key in value);
        return {
          index,
          commandType,
          supported: hasKnownSelector,
          ...(!hasKnownSelector ? { reason: "tapOn object must contain a recognized selector (text, resourceId, contentDescription)." } : {}),
        };
      }
      return { index, commandType, supported: false, reason: "tapOn requires a non-empty target string or selector object." };
    case "assertText": {
      if (typeof value !== "string" || value.trim().length === 0) {
        return { index, commandType, supported: false, reason: "assertText requires a non-empty target::value payload." };
      }
      const rawValue = value.trim();
      const [targetText, expectedValue] = rawValue.split("::", 2);
      if (!targetText || expectedValue === undefined || expectedValue.length === 0) {
        return { index, commandType, supported: false, reason: `assertText syntax at index ${index} must be "target::value".` };
      }
      return { index, commandType, supported: true };
    }
    case "selectOption": {
      if (typeof value !== "string" || value.trim().length === 0) {
        return { index, commandType, supported: false, reason: "selectOption requires a non-empty target::option payload." };
      }
      const rawValue = value.trim();
      const [targetText, option] = rawValue.split("::", 2);
      if (!targetText || option === undefined || option.length === 0) {
        return { index, commandType, supported: false, reason: `selectOption syntax at index ${index} must be "target::option".` };
      }
      return { index, commandType, supported: true };
    }
    case "inputText":
      if (typeof value !== "string" || value.trim().length === 0) {
        return { index, commandType, supported: false, reason: "inputText requires a non-empty value." };
      }
      return { index, commandType, supported: true };
    case "scroll":
    case "swipe":
      if (typeof value !== "string" || !isDirectionValue(value)) {
        return { index, commandType, supported: false, reason: `${commandType} requires direction as one of UP, DOWN, LEFT, RIGHT.` };
      }
      return { index, commandType, supported: true };
    case "screenshot":
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return { index, commandType, supported: false, reason: "screenshot does not accept scalar value." };
      }
      return { index, commandType, supported: true };
    case "waitForAnimation":
      if (!isPositiveInteger(value)) {
        return { index, commandType, supported: false, reason: "waitForAnimation requires timeoutMs as a positive integer." };
      }
      return { index, commandType, supported: true };
    case "windowFocus":
      if (typeof value !== "string" || value.trim().length === 0) {
        return { index, commandType, supported: false, reason: "windowFocus requires a non-empty target." };
      }
      return { index, commandType, supported: true };
    case "clipboardRead":
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return { index, commandType, supported: false, reason: "clipboardRead does not accept a scalar value." };
      }
      return { index, commandType, supported: true };
    case "clipboardWrite":
      if (typeof value !== "string" || value.trim().length === 0) {
        return { index, commandType, supported: false, reason: "clipboardWrite requires a non-empty value." };
      }
      return { index, commandType, supported: true };
    default:
      return { index, commandType, supported: false, reason: "Unsupported command form." };
  }
}

/** Validate an object-based typed command shape. */
export function validateObjectAutomationCommand(
  commandType: string,
  rawStep: ParsedFlowYamlObject,
  index: number,
): AutomationStepAnalysis {
  const unsupportedFields = Object.keys(rawStep).filter((key) => key !== "type" && key !== "target" && key !== "value" && key !== "direction"
    && key !== "steps" && key !== "distanceFraction" && key !== "timeoutMs" && key !== "option");
  if (unsupportedFields.length > 0) {
    return { index, commandType, supported: false, reason: `Unsupported command fields: ${unsupportedFields.join(", ")}` };
  }

  switch (commandType) {
    case "launchApp":
    case "hideKeyboard":
      return { index, commandType, supported: Object.keys(rawStep).length === 1 };
    case "tapOn":
      if (!isTapTargetValue(rawStep.target)) {
        return { index, commandType, supported: false, reason: "tapOn requires a selector target or both x and y coordinates." };
      }
      return { index, commandType, supported: true };
    case "assertVisible":
    case "assertNotVisible":
      if (!isTargetValue(rawStep.target)) {
        return { index, commandType, supported: false, reason: `${commandType} requires a selector target.` };
      }
      return { index, commandType, supported: true };
    case "assertText":
      if (!isTargetValue(rawStep.target)) {
        return { index, commandType, supported: false, reason: "assertText requires a selector target." };
      }
      if (typeof rawStep.value !== "string" || rawStep.value.trim().length === 0) {
        return { index, commandType, supported: false, reason: "assertText requires a non-empty value." };
      }
      return { index, commandType, supported: true };
    case "selectOption":
      if (!isTargetValue(rawStep.target)) {
        return { index, commandType, supported: false, reason: "selectOption requires a selector target." };
      }
      if (typeof rawStep.option !== "string" || rawStep.option.trim().length === 0) {
        return { index, commandType, supported: false, reason: "selectOption requires a non-empty option." };
      }
      return { index, commandType, supported: true };
    case "windowFocus":
      if (rawStep.target === undefined) {
        return { index, commandType, supported: false, reason: "windowFocus requires a target." };
      }
      if (rawStep.value !== undefined) {
        return { index, commandType, supported: false, reason: "windowFocus does not accept a value." };
      }
      if (!isWindowTargetValue(rawStep.target)) {
        return { index, commandType, supported: false, reason: "windowFocus target must include appId and/or title." };
      }
      return { index, commandType, supported: true };
    case "clipboardRead":
      if (rawStep.target !== undefined || rawStep.value !== undefined) {
        return { index, commandType, supported: false, reason: "clipboardRead does not accept a target or value." };
      }
      return { index, commandType, supported: true };
    case "clipboardWrite":
      if (rawStep.target !== undefined) {
        return { index, commandType, supported: false, reason: "clipboardWrite does not accept a target." };
      }
      if (typeof rawStep.value !== "string" || rawStep.value.trim().length === 0) {
        return { index, commandType, supported: false, reason: "clipboardWrite requires a non-empty value." };
      }
      return { index, commandType, supported: true };
    case "inputText":
      if (typeof rawStep.value !== "string" || rawStep.value.trim().length === 0) {
        return { index, commandType, supported: false, reason: "inputText requires a non-empty value." };
      }
      return { index, commandType, supported: true };
    case "scroll":
      if (typeof rawStep.direction !== "string" || !isDirectionValue(rawStep.direction)) {
        return { index, commandType, supported: false, reason: "scroll requires direction: UP | DOWN | LEFT | RIGHT." };
      }
      if (rawStep.steps !== undefined && !isPositiveInteger(rawStep.steps)) {
        return { index, commandType, supported: false, reason: "scroll steps must be a positive integer." };
      }
      return { index, commandType, supported: true };
    case "swipe":
      if (typeof rawStep.direction !== "string" || !isDirectionValue(rawStep.direction)) {
        return { index, commandType, supported: false, reason: "swipe requires direction: UP | DOWN | LEFT | RIGHT." };
      }
      if (rawStep.distanceFraction !== undefined) {
        const distance = rawStep.distanceFraction;
        if (typeof distance !== "number" || !Number.isFinite(distance) || distance < 0.2 || distance > 0.95) {
          return { index, commandType, supported: false, reason: "swipe distanceFraction must be a number between 0.2 and 0.95." };
        }
      }
      return { index, commandType, supported: true };
    case "screenshot":
      return { index, commandType, supported: true };
    case "waitForAnimation":
      if (!isPositiveInteger(rawStep.timeoutMs)) {
        return { index, commandType, supported: false, reason: "waitForAnimation requires timeoutMs as a positive integer." };
      }
      return { index, commandType, supported: true };
    default:
      return { index, commandType, supported: false, reason: "Unsupported command." };
  }
}

/** Validate direction values against the canonical four-way movement enum. */
export function isDirectionValue(value: string): boolean {
  const normalized = value.trim().toUpperCase();
  return normalized === "UP" || normalized === "DOWN" || normalized === "LEFT" || normalized === "RIGHT";
}

/** Check whether a parsed YAML value is a positive integer. */
export function isPositiveInteger(value: ParsedFlowYamlValue | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

/** Check whether a target value is a supported selector target. */
export function isTargetValue(value: ParsedFlowYamlValue | undefined): boolean {
  return isSelectorTargetValue(value);
}

/** Check whether a tap target is either a selector target or explicit coordinates. */
export function isTapTargetValue(value: ParsedFlowYamlValue | undefined): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || !isParsedFlowYamlObject(value)) {
    return false;
  }
  const target = value;
  const keys = Object.keys(target);
  if (keys.length === 0) {
    return false;
  }
  const hasCoordinatePair = keys.every((key) => key === "x" || key === "y")
    && typeof target.x === "number"
    && Number.isFinite(target.x)
    && Number.isInteger(target.x)
    && typeof target.y === "number"
    && Number.isFinite(target.y)
    && Number.isInteger(target.y);
  return hasCoordinatePair || isSelectorTargetValue(value);
}

/** Check whether a selector target uses supported selector keys only. */
export function isSelectorTargetValue(value: ParsedFlowYamlValue | undefined): boolean {
  if (typeof value === "string" && value.trim().length > 0) {
    return true;
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || !isParsedFlowYamlObject(value)) {
    return false;
  }

  const target = value;
  const selectors = ["resourceId", "text", "contentDescription", "x", "y"];
  const keys = Object.keys(target);
  if (keys.length === 0 || keys.some((key) => !selectors.includes(key))) {
    return false;
  }
  const hasSelector = typeof target.resourceId === "string" && target.resourceId.trim().length > 0
    || typeof target.text === "string" && target.text.trim().length > 0
    || typeof target.contentDescription === "string" && target.contentDescription.trim().length > 0;
  if (!hasSelector) {
    return false;
  }
  return keys.every((key) => {
    const raw = target[key];
    if (key === "resourceId" || key === "text" || key === "contentDescription") {
      return typeof raw === "string" && raw.trim().length > 0;
    }
    if (key === "x" || key === "y") {
      return typeof raw === "number" && Number.isFinite(raw) && Number.isInteger(raw);
    }
    return false;
  });
}

/** Check whether a window-focus target includes a supported appId/title selector. */
export function isWindowTargetValue(value: ParsedFlowYamlValue | undefined): boolean {
  if (typeof value === "string" && value.trim().length > 0) {
    return true;
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || !isParsedFlowYamlObject(value)) {
    return false;
  }
  const target = value;
  const keys = Object.keys(target);
  if (keys.length === 0 || keys.some((key) => key !== "appId" && key !== "title")) {
    return false;
  }
  const hasAppId = typeof target.appId === "string" && target.appId.trim().length > 0;
  const hasTitle = typeof target.title === "string" && target.title.trim().length > 0;
  return hasAppId || hasTitle;
}

/** Assert that a parsed YAML value is an object. */
export function asFlowRecord(value: ParsedFlowYamlValue, message: string): ParsedFlowYamlObject {
  if (isParsedFlowYamlObject(value)) {
    return value;
  }
  throw createFlowCapabilityError({
    commandIndex: -1,
    command: "flow",
    reason: message,
    retryable: false,
    surface: "flow_automation",
  });
}

/** Assert that a parsed YAML value is an array. */
export function asFlowArray(value: ParsedFlowYamlValue | undefined, message: string): ParsedFlowYamlValue[] {
  if (Array.isArray(value)) {
    return value;
  }
  throw createFlowCapabilityError({
    commandIndex: -1,
    command: "steps",
    reason: message,
    retryable: false,
    surface: "flow_automation",
  });
}

/** Assert that a parsed YAML value is a non-empty string. */
export function asFlowText(value: ParsedFlowYamlValue | undefined, message: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  throw createFlowCapabilityError({
    commandIndex: -1,
    command: "appId",
    reason: message,
    retryable: false,
    surface: "flow_automation",
  });
}
