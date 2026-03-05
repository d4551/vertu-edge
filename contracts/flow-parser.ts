import {
  FLOW_VERSION,
  type CommandTarget,
  type Direction,
  type FlowCommand,
  type WindowTarget,
  createFlowCapabilityError,
  isFlowCommandType,
  type FlowV1,
} from "./flow-contracts";

/** Normalized in-memory flow shape before runtime execution. */
export interface NormalizedFlow extends FlowV1 {}

type ParsedFlowScalar = string | number | boolean | null;
type ParsedFlowValue = ParsedFlowScalar | ParsedFlowObject | ParsedFlowArray;
interface ParsedFlowObject {
  [key: string]: ParsedFlowValue | undefined;
}
interface ParsedFlowArray extends Array<ParsedFlowValue> {}

/**
 * Parse Maestro-style flow YAML into canonical `FlowV1`.
 * Supports single document object flows and Maestro two-document format.
 */
export function parseMaestroFlowYaml(rawYaml: string): FlowV1 {
  const documents = parseYamlDocuments(rawYaml);

  if (documents.length === 0) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "flow",
      reason: "Flow payload is empty.",
      retryable: false,
    });
  }

  if (documents.length > 2) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "flow",
      reason: "Flow YAML must include a single document or config+commands documents only.",
      retryable: false,
    });
  }

  if (documents.length === 1) {
    const single = documents[0];
    if (!single) {
      throw createFlowCapabilityError({
        commandIndex: -1,
        command: "flow",
        reason: "Flow YAML must contain a valid object document.",
        retryable: false,
      });
    }
    return normalizeFlowDocument(single);
  }

  const firstDocument = documents[0];
  const secondDocument = documents[1];

  if (!firstDocument || !secondDocument) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "flow",
      reason: "Flow YAML must include a config document and command list document.",
      retryable: false,
    });
  }

  const first = assertRecord(firstDocument, "Flow YAML config document must be an object.");
  const appId = assertNonEmptyString(first.appId, "Flow YAML config document must define appId.");
  const version = assertVersion(first.version);
  const second = assertArray(secondDocument, "Flow YAML second document must be an array of steps.");

  return normalizeFlowDocument({ appId, steps: second, version });
}

function parseYamlDocuments(rawYaml: string): ParsedFlowValue[] {
  const source = rawYaml.replace(/\r\n/g, "\n").trim();
  if (source.length === 0) {
    return [];
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

  return docs.map((doc) => Bun.YAML.parse(doc) as ParsedFlowValue);
}

/**
 * Normalize arbitrary parsed flow JSON into strict `FlowV1`.
 */
export function normalizeFlowDocument(input: ParsedFlowValue): FlowV1 {
  const raw = assertRecord(input, "Flow root must be an object.");
  const appId = assertNonEmptyString(raw.appId, "Flow appId must be a non-empty string.");
  const version = assertVersion(raw.version);
  const rawSteps = assertArray(raw.steps, "Flow steps must be an array.");

  const steps = rawSteps.map((step, index) => {
    return normalizeStep(step, index);
  });

  return {
    version,
    appId,
    steps,
  };
}

function normalizeStep(step: ParsedFlowValue, index: number): FlowCommand {
  if (step === null || step === undefined) {
    throw createFlowCapabilityError({
      commandIndex: index,
      command: "step",
      reason: `Step at index ${index} must be an object or string command.`,
      retryable: false,
    });
  }

  if (typeof step === "string") {
    return normalizeScalarStep(step, index);
  }

  if (typeof step === "object") {
    if (Array.isArray(step)) {
      throw createFlowCapabilityError({
        commandIndex: index,
        command: "step",
        reason: `Step at index ${index} must be an object or string command.`,
        retryable: false,
      });
    }
    const rawStep = step as ParsedFlowObject;
    if (typeof rawStep.type === "string") {
      return normalizeTypedStep(rawStep, index);
    }

    const keys = Object.keys(rawStep);
    if (keys.length !== 1) {
      throw createFlowCapabilityError({
        commandIndex: index,
        command: "step",
        reason: `Maestro-style scalar step at index ${index} must contain exactly one key.`,
        retryable: false,
      });
    }

    const [key] = keys;
    if (!key) {
      throw createFlowCapabilityError({
        commandIndex: index,
        command: "step",
        reason: `Step at index ${index} is missing a command key.`,
        retryable: false,
      });
    }
    const value = rawStep[key];
    if (!isFlowCommandType(key)) {
      throw createFlowCapabilityError({
        commandIndex: index,
        command: key,
        reason: `Unsupported command key at index ${index}: ${key}`,
        retryable: false,
      });
    }

    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      value !== null &&
      value !== undefined
    ) {
      throw createFlowCapabilityError({
        commandIndex: index,
        command: key,
        reason: `Unsupported scalar value for command ${key} at index ${index}.`,
        retryable: false,
      });
    }

    return normalizeMaestroScalarStep(key, value, index);
  }

  throw createFlowCapabilityError({
    commandIndex: index,
    command: "step",
    reason: `Step at index ${index} must be an object or string command.`,
    retryable: false,
  });
}

function normalizeScalarStep(raw: string, index: number): FlowCommand {
  if (raw === "launchApp" || raw === "hideKeyboard" || raw === "screenshot" || raw === "clipboardRead") {
    return { type: raw } as FlowCommand;
  }

  throw createFlowCapabilityError({
    commandIndex: index,
    command: raw,
    reason: `Unsupported scalar command at index ${index}: ${raw}`,
    retryable: false,
  });
}

function normalizeTypedStep(rawStep: ParsedFlowObject, index: number): FlowCommand {
  const rawType = rawStep.type;
  const type = rawType as FlowCommand["type"] | string;

  if (!isFlowCommandType(type)) {
    throw createFlowCapabilityError({
      commandIndex: index,
      command: String(type),
      reason: `Unsupported step type at index ${index}: ${String(type)}`,
      retryable: false,
    });
  }

  if (type === "launchApp") {
    assertNoExtraKeys(rawStep, ["type"], `launchApp step at index ${index}`);
    return { type };
  }

  if (type === "hideKeyboard") {
    assertNoExtraKeys(rawStep, ["type"], `hideKeyboard step at index ${index}`);
    return { type };
  }

  if (type === "tapOn") {
    return {
      type,
      target: normalizeTapTarget(
        rawStep.target,
        `tapOn step target at index ${index}`,
      ),
    };
  }

  if (type === "inputText") {
    assertNoExtraKeys(rawStep, ["type", "value"], `inputText step at index ${index}`);
    return {
      type,
      value: assertNonEmptyString(rawStep.value, `inputText value missing at index ${index}`),
    };
  }

  if (type === "assertVisible") {
    return {
      type,
      target: normalizeSelectorTarget(
        rawStep.target,
        `assertVisible step target at index ${index}`,
      ),
    };
  }

  if (type === "assertNotVisible") {
    return {
      type,
      target: normalizeSelectorTarget(
        rawStep.target,
        `assertNotVisible step target at index ${index}`,
      ),
    };
  }

  if (type === "assertText") {
    assertNoExtraKeys(rawStep, ["type", "target", "value"], `assertText step at index ${index}`);
    if (rawStep.value !== undefined && typeof rawStep.value === "string" && rawStep.value.trim().length === 0) {
      throw createFlowCapabilityError({
        commandIndex: index,
        command: "assertText",
        reason: `assertText value at index ${index} must not be empty.`,
        retryable: false,
      });
    }
    return {
      type,
      target: normalizeSelectorTarget(
        rawStep.target,
        `assertText step target at index ${index}`,
      ),
      value: assertString(rawStep.value, `assertText value missing at index ${index}`),
    };
  }

  if (type === "selectOption") {
    assertNoExtraKeys(rawStep, ["type", "target", "option"], `selectOption step at index ${index}`);
    if (rawStep.option !== undefined && typeof rawStep.option === "string" && rawStep.option.trim().length === 0) {
      throw createFlowCapabilityError({
        commandIndex: index,
        command: "selectOption",
        reason: `selectOption option at index ${index} must not be empty.`,
        retryable: false,
      });
    }
    return {
      type,
      target: normalizeSelectorTarget(
        rawStep.target,
        `selectOption step target at index ${index}`,
      ),
      option: assertString(rawStep.option, `selectOption option missing at index ${index}`),
    };
  }

  if (type === "scroll") {
    const command: { type: "scroll"; direction: Direction; steps?: number } = {
      type,
      direction: toDirection(assertString(rawStep.direction, `scroll direction missing at index ${index}`)),
    };

    if (rawStep.steps !== undefined) {
      command.steps = assertPositiveInteger(
        rawStep.steps,
        `scroll steps at index ${index} must be a positive integer.`,
      );
    }

    assertNoExtraKeys(rawStep, ["type", "direction", "steps"], `scroll step at index ${index}`);
    return command;
  }

  if (type === "swipe") {
    const command: { type: "swipe"; direction: Direction; distanceFraction?: number } = {
      type,
      direction: toDirection(assertString(rawStep.direction, `swipe direction missing at index ${index}`)),
    };

    if (rawStep.distanceFraction !== undefined) {
      command.distanceFraction = assertNumberInRange(
        rawStep.distanceFraction,
        0.2,
        0.95,
        `swipe distanceFraction invalid at index ${index}.`,
      );
    }

    assertNoExtraKeys(rawStep, ["type", "direction", "distanceFraction"], `swipe step at index ${index}`);
    return command;
  }

  if (type === "screenshot") {
    assertNoExtraKeys(rawStep, ["type"], `screenshot step at index ${index}`);
    return { type };
  }

  if (type === "clipboardRead") {
    assertNoExtraKeys(rawStep, ["type"], `clipboardRead step at index ${index}`);
    return { type };
  }

  if (type === "clipboardWrite") {
    assertNoExtraKeys(rawStep, ["type", "value"], `clipboardWrite step at index ${index}`);
    return {
      type,
      value: assertString(rawStep.value, `clipboardWrite value missing at index ${index}`),
    };
  }

  if (type === "windowFocus") {
    assertNoExtraKeys(rawStep, ["type", "target"], `windowFocus step at index ${index}`);
    return {
      type,
      target: normalizeWindowTarget(rawStep.target, `windowFocus target at index ${index}`),
    };
  }

  if (type === "waitForAnimation") {
    assertNoExtraKeys(rawStep, ["type", "timeoutMs"], `waitForAnimation step at index ${index}`);
    const command: { type: "waitForAnimation"; timeoutMs?: number } = { type };
    if (rawStep.timeoutMs !== undefined) {
      command.timeoutMs = assertPositiveInteger(
        rawStep.timeoutMs,
        `waitForAnimation timeoutMs invalid at index ${index}.`,
      );
    }
    return command;
  }

  throw createFlowCapabilityError({
    commandIndex: index,
    command: type,
    reason: `Unsupported step type at index ${index}: ${type}`,
    retryable: false,
  });
}

function normalizeMaestroScalarStep(
  key: FlowCommand["type"],
  value: ParsedFlowValue | undefined,
  index: number,
): FlowCommand {
  if (key === "launchApp" || key === "hideKeyboard") {
    if (value !== "" && value !== undefined && value !== null) {
      throw createFlowCapabilityError({
        commandIndex: index,
        command: key,
        reason: `${key} does not accept scalar value at index ${index}.`,
        retryable: false,
      });
    }
    return { type: key };
  }

  if (key === "tapOn" || key === "assertVisible" || key === "assertNotVisible") {
    const targetValue = assertString(value, `${key} target at index ${index}`);
    return {
      type: key,
      target: toTarget(targetValue),
    };
  }

  if (key === "assertText") {
    const rawValue = assertString(value, `assertText scalar value at index ${index}`);
    const [targetText, expectedValue] = rawValue.split("::", 2);
    if (!targetText || expectedValue === undefined || expectedValue.length === 0) {
      throw createFlowCapabilityError({
        commandIndex: index,
        command: key,
        reason: `assertText scalar syntax at index ${index} must be "target::value".`,
        retryable: false,
      });
    }
    return {
      type: "assertText",
      target: toTarget(targetText),
      value: expectedValue,
    };
  }

  if (key === "selectOption") {
    const rawValue = assertString(value, `selectOption scalar value at index ${index}`);
    const [targetText, option] = rawValue.split("::", 2);
    if (!targetText || option === undefined || option.length === 0) {
      throw createFlowCapabilityError({
        commandIndex: index,
        command: key,
        reason: `selectOption scalar syntax at index ${index} must be "target::option".`,
        retryable: false,
      });
    }
    return {
      type: "selectOption",
      target: toTarget(targetText),
      option,
    };
  }

  if (key === "inputText") {
    return {
      type: "inputText",
      value: assertNonEmptyString(value, `inputText value at index ${index}`),
    };
  }

  if (key === "screenshot") {
    if (value !== "" && value !== undefined && value !== null) {
      throw createFlowCapabilityError({
        commandIndex: index,
        command: key,
        reason: `screenshot does not accept scalar value at index ${index}.`,
        retryable: false,
      });
    }
    return { type: "screenshot" };
  }

  if (key === "clipboardRead") {
    if (value !== "" && value !== undefined && value !== null) {
      throw createFlowCapabilityError({
        commandIndex: index,
        command: key,
        reason: `clipboardRead does not accept scalar value at index ${index}.`,
        retryable: false,
      });
    }
    return { type: "clipboardRead" };
  }

  if (key === "clipboardWrite") {
    return {
      type: "clipboardWrite",
      value: assertString(value, `clipboardWrite value at index ${index}`),
    };
  }

  if (key === "windowFocus") {
    const rawTarget = assertString(value, `windowFocus target at index ${index}`).trim();
    if (rawTarget.length === 0) {
      throw createFlowCapabilityError({
        commandIndex: index,
        command: key,
        reason: `windowFocus target at index ${index} must not be empty.`,
        retryable: false,
      });
    }
    if (rawTarget.includes("=") || rawTarget.includes("|")) {
      const pieces = rawTarget
        .split("|")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      const target: WindowTarget = {};
      for (const piece of pieces) {
        if (piece.startsWith("appId=")) {
          target.appId = piece.slice("appId=".length);
          continue;
        }
        if (piece.startsWith("title=")) {
          target.title = piece.slice("title=".length);
        }
      }
      if (!target.appId && !target.title) {
        target.title = rawTarget;
      }
      return { type: "windowFocus", target };
    }
    return { type: "windowFocus", target: { title: rawTarget } };
  }

  if (key === "scroll" || key === "swipe") {
    return {
      type: key,
      direction: toDirection(assertString(value, `${key} direction at index ${index}`)),
    };
  }

  if (key === "waitForAnimation") {
    return {
      type: "waitForAnimation",
      timeoutMs: assertPositiveInteger(value, `waitForAnimation timeoutMs invalid at index ${index}.`),
    };
  }

  throw createFlowCapabilityError({
    commandIndex: index,
    command: key,
    reason: `Unsupported command ${key} at index ${index}.`,
    retryable: false,
  });
}

function normalizeTarget(value: ParsedFlowValue | undefined, message: string): CommandTarget {
  if (typeof value === "string") {
    return toTarget(value, message);
  }

  const rawTarget = assertRecord(value, `${message} must be a string or object.`);
  const target: CommandTarget = {};
  const resourceId = asOptionalString(rawTarget.resourceId, `${message}.resourceId must be a string if provided.`);
  const text = asOptionalString(rawTarget.text, `${message}.text must be a string if provided.`);
  const contentDescription = asOptionalString(
    rawTarget.contentDescription,
    `${message}.contentDescription must be a string if provided.`,
  );
  const x = asOptionalInteger(rawTarget.x, `${message}.x must be an integer if provided.`);
  const y = asOptionalInteger(rawTarget.y, `${message}.y must be an integer if provided.`);

  if (resourceId !== undefined) {
    if (resourceId.length === 0) {
      throw createFlowCapabilityError({
        commandIndex: -1,
        command: "resourceId",
        reason: `${message}.resourceId must not be empty.`,
        retryable: false,
      });
    }
    target.resourceId = resourceId;
  }

  if (text !== undefined) {
    if (text.length === 0) {
      throw createFlowCapabilityError({
        commandIndex: -1,
        command: "text",
        reason: `${message}.text must not be empty.`,
        retryable: false,
      });
    }
    target.text = text;
  }

  if (contentDescription !== undefined) {
    if (contentDescription.length === 0) {
      throw createFlowCapabilityError({
        commandIndex: -1,
        command: "contentDescription",
        reason: `${message}.contentDescription must not be empty.`,
        retryable: false,
      });
    }
    target.contentDescription = contentDescription;
  }

  if (x !== undefined) {
    target.x = x;
  }

  if (y !== undefined) {
    target.y = y;
  }

  if (Object.keys(target).length === 0) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "target",
      reason: `${message} must include at least one target field.`,
      retryable: false,
    });
  }

  assertNoExtraKeys(
    rawTarget,
    ["resourceId", "text", "contentDescription", "x", "y"],
    `${message} target must only include supported selector fields.`,
  );

  return target;
}

function normalizeSelectorTarget(value: ParsedFlowValue | undefined, message: string): CommandTarget {
  const target = normalizeTarget(value, message);
  const hasResourceId = typeof target.resourceId === "string" && target.resourceId.length > 0;
  const hasText = typeof target.text === "string" && target.text.length > 0;
  const hasContentDescription = typeof target.contentDescription === "string" && target.contentDescription.length > 0;
  if (!hasResourceId && !hasText && !hasContentDescription) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "target",
      reason: `${message} selector target must include resourceId, text, or contentDescription.`,
      retryable: false,
    });
  }
  return target;
}

function normalizeTapTarget(value: ParsedFlowValue | undefined, message: string): CommandTarget {
  const target = normalizeTarget(value, message);
  const hasResourceId = typeof target.resourceId === "string" && target.resourceId.length > 0;
  const hasText = typeof target.text === "string" && target.text.length > 0;
  const hasContentDescription = typeof target.contentDescription === "string" && target.contentDescription.length > 0;
  const hasCoordinates = typeof target.x === "number" && typeof target.y === "number"
    && Number.isInteger(target.x) && Number.isInteger(target.y);

  if (!hasResourceId && !hasText && !hasContentDescription && !hasCoordinates) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "target",
      reason: `${message} must include either a selector (resourceId/text/contentDescription) or both x and y coordinates.`,
      retryable: false,
    });
  }

  return target;
}

function normalizeWindowTarget(value: ParsedFlowValue | undefined, message: string): WindowTarget {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw createFlowCapabilityError({
        commandIndex: -1,
        command: "windowFocus",
        reason: `${message} must not be empty.`,
        retryable: false,
      });
    }
    return { title: trimmed };
  }

  const rawTarget = assertRecord(value, `${message} must be a string or object.`);
  const appId = asOptionalString(rawTarget.appId, `${message}.appId must be a string if provided.`);
  const title = asOptionalString(rawTarget.title, `${message}.title must be a string if provided.`);
  if ((!appId || appId.length === 0) && (!title || title.length === 0)) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "windowFocus",
      reason: `${message} must include appId or title.`,
      retryable: false,
    });
  }

  const target: WindowTarget = {};
  if (appId && appId.length > 0) target.appId = appId;
  if (title && title.length > 0) target.title = title;
  assertNoExtraKeys(rawTarget, ["appId", "title"], `${message} target only supports appId/title.`);
  return target;
}

function toDirection(value: string): Direction {
  const normalized = value.trim().toUpperCase();
  if (
    normalized === "UP" ||
    normalized === "DOWN" ||
    normalized === "LEFT" ||
    normalized === "RIGHT"
  ) {
    return normalized;
  }
  throw createFlowCapabilityError({
    commandIndex: -1,
    command: "direction",
    reason: `Unsupported direction: ${value}`,
    retryable: false,
  });
}

function assertVersion(value: ParsedFlowValue | undefined): typeof FLOW_VERSION {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value === 1 || value === 1.0) {
      return FLOW_VERSION;
    }
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "version",
      reason: `Unsupported flow version '${value}'. Expected '${FLOW_VERSION}'.`,
      retryable: false,
    });
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "version",
      reason: "Flow YAML must include version. Set version: \"1.0\".",
      retryable: false,
    });
  }

  const normalized = value.trim();
  if (normalized !== FLOW_VERSION && normalized !== "1") {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "version",
      reason: `Unsupported flow version '${normalized}'. Expected '${FLOW_VERSION}'.`,
      retryable: false,
    });
  }
  return FLOW_VERSION;
}

function assertRecord(value: ParsedFlowValue | undefined, message: string): ParsedFlowObject {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as ParsedFlowObject;
  }
  throw createFlowCapabilityError({
    commandIndex: -1,
    command: "flow",
    reason: message,
    retryable: false,
  });
}

function assertArray(value: ParsedFlowValue | undefined, message: string): ParsedFlowValue[] {
  if (Array.isArray(value)) {
    return value;
  }
  throw createFlowCapabilityError({
    commandIndex: -1,
    command: "steps",
    reason: message,
    retryable: false,
  });
}

function assertString(value: ParsedFlowValue | undefined, message: string): string {
  if (typeof value === "string") {
    return value;
  }
  throw createFlowCapabilityError({
    commandIndex: -1,
    command: "step-value",
    reason: message,
    retryable: false,
  });
}

function assertNonEmptyString(value: ParsedFlowValue | undefined, message: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  throw createFlowCapabilityError({
    commandIndex: -1,
    command: "step-value",
    reason: message,
    retryable: false,
  });
}

function assertNumberInRange(
  value: ParsedFlowValue | undefined,
  min: number,
  max: number,
  message: string,
): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max) {
    return value;
  }
  throw createFlowCapabilityError({
    commandIndex: -1,
    command: "step-value",
    reason: message,
    retryable: false,
  });
}

function assertPositiveInteger(value: ParsedFlowValue | undefined, message: string): number {
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 1) {
    return value;
  }
  throw createFlowCapabilityError({
    commandIndex: -1,
    command: "step-value",
    reason: message,
    retryable: false,
  });
}

function asOptionalString(value: ParsedFlowValue | undefined, message: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value.trim();
  }
  throw createFlowCapabilityError({
    commandIndex: -1,
    command: "target",
    reason: message,
    retryable: false,
  });
}

function asOptionalInteger(value: ParsedFlowValue | undefined, message: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)) {
    return value;
  }
  throw createFlowCapabilityError({
    commandIndex: -1,
    command: "target",
    reason: message,
    retryable: false,
  });
}

function assertNoExtraKeys(
  value: ParsedFlowObject,
  allowedKeys: readonly string[],
  message: string,
): void {
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length > 0) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "step",
      reason: `${message} contains unsupported fields: ${unknownKeys.join(", ")}.`,
      retryable: false,
    });
  }
}

function toTarget(value: string, fallbackMessage = "target"): CommandTarget {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: fallbackMessage,
      reason: `${fallbackMessage} must not be empty.`,
      retryable: false,
    });
  }

  if (normalized.startsWith("id=")) {
    return { resourceId: normalized.slice("id=".length) };
  }
  if (normalized.startsWith("contentDescription=")) {
    return { contentDescription: normalized.slice("contentDescription=".length) };
  }
  if (normalized.includes(",")) {
    const [xText, yText] = normalized.split(",").map((entry) => entry.trim());
    const x = Number(xText);
    const y = Number(yText);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isInteger(x) && Number.isInteger(y)) {
      return { x, y };
    }
  }
  return { text: normalized };
}
