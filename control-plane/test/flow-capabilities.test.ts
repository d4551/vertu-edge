import { expect, test } from "bun:test";
import { parseMaestroYaml } from "../src/yaml-parser";
import { RPADriver, getFlowTargetCapabilityProbe } from "../src/flow-engine";
import { analyzeAutomationStep } from "../src/flow-automation";
import {
  FLOW_VERSION,
  type FlowCommand,
  type FlowV1,
  createFlowCapabilityError,
  isFlowCapabilityError,
} from "../../contracts/flow-contracts";

test("parseMaestroYaml parses canonical object flow payload", () => {
  const parsed = parseMaestroYaml([
    "version: \"1.0\"",
    "appId: com.vertu.edge",
    "steps:",
    "  - launchApp",
    "  - inputText: hello",
  ].join("\n"));

  expect(parsed.version).toBe(FLOW_VERSION);
  expect(parsed.appId).toBe("com.vertu.edge");
  expect(parsed.steps.length).toBe(2);
});

test("parseMaestroYaml supports scalar parity commands", () => {
  const parsed = parseMaestroYaml([
    "version: \"1.0\"",
    "appId: com.vertu.edge",
    "steps:",
    "  - screenshot",
    "  - assertText: \"Welcome::Welcome\"",
    "  - selectOption: \"Language::English\"",
    "  - windowFocus: \"title=Finder\"",
    "  - clipboardRead",
  ].join("\n"));

  expect(parsed.steps.length).toBe(5);
  expect(parsed.steps[0]).toEqual({ type: "screenshot" });
  expect(parsed.steps[1]).toEqual({
    type: "assertText",
    target: { text: "Welcome" },
    value: "Welcome",
  });
  expect(parsed.steps[2]).toEqual({
    type: "selectOption",
    target: { text: "Language" },
    option: "English",
  });
  expect(parsed.steps[3]).toEqual({
    type: "windowFocus",
    target: { title: "Finder" },
  });
  expect(parsed.steps[4]).toEqual({ type: "clipboardRead" });
});

test("parseMaestroYaml rejects unsupported commands with typed command index", async () => {
  const failure = await Promise.resolve()
    .then(() => parseMaestroYaml([
      "version: \"1.0\"",
      "appId: com.vertu.edge",
      "steps:",
      "  - totallyUnsupported: value",
    ].join("\n")))
    .then(
      () => new Error("Expected parser failure for unsupported command"),
      (rejection) => rejection,
    );

  expect(isFlowCapabilityError(failure)).toBe(true);
  if (isFlowCapabilityError(failure)) {
    expect(failure.commandIndex).toBe(0);
    expect(failure.retryable).toBe(false);
    expect(typeof failure.reason).toBe("string");
  }
});

test("RPADriver returns deterministic unsupported command failure details", async () => {
  const driver = new RPADriver();
  const invalid = {
    version: FLOW_VERSION,
    appId: "com.vertu.edge",
    steps: [{ type: "launchApp" }],
  } satisfies FlowV1;
  const invalidSteps = invalid.steps as Array<{ type: string }>;
  invalidSteps[0] = { type: "totallyUnsupported" };

  const result = await driver.executeFlow(invalid, {
    commandRunner: async () => ({ state: "success", message: "bypass" }),
  });
  expect(result.state).toBe("error-non-retryable");
  expect(result.results.length).toBe(1);
  expect(result.results[0]?.commandIndex).toBe(0);
  expect(result.results[0]?.state).toBe("unsupported");
  expect(result.results[0]?.error?.retryable).toBe(false);
});

test("RPADriver records retryable attempts and successful recovery in action telemetry", async () => {
  const driver = new RPADriver();
  const started: Array<{ commandIndex: number; attempt: number; commandType: FlowCommand["type"] }> = [];
  const completed: Array<{ attempt: number; commandType: FlowCommand["type"]; state: string }> = [];
  let attempt = 0;

  driver.hooks = {
    onCommandStart: (context) => {
      started.push({
        commandIndex: context.commandIndex,
        attempt: context.attempt,
        commandType: context.commandType,
      });
    },
    onCommandComplete: (context) => {
      completed.push({
        attempt: context.attempt,
        commandType: context.commandType,
        state: context.result.state,
      });
    },
  };

  const flow: FlowV1 = {
    version: FLOW_VERSION,
    appId: "com.vertu.edge",
    steps: [{ type: "launchApp" }],
  };

  const result = await driver.executeFlow(flow, {
    maxAttempts: 2,
    commandRunner: async (_script, _timeoutMs, command) => {
      attempt += 1;
      if (attempt === 1) {
        return {
          state: "error",
          message: "intermittent failure",
          error: createFlowCapabilityError({
            commandIndex: 0,
            command: command.type,
            commandType: command.type,
            reason: "intermittent failure",
            retryable: true,
            surface: "flow",
          }),
        };
      }

      return {
        state: "success",
        message: "launchApp executed",
      };
    },
  });

  expect(result.state).toBe("success");
  expect(result.actions?.length).toBe(1);
  expect(started).toHaveLength(2);
  expect(completed).toHaveLength(2);
  expect(result.actions?.[0]?.attempts).toEqual(expect.arrayContaining([
    expect.objectContaining({ state: "error", attempt: 1 }),
    expect.objectContaining({ state: "success", attempt: 2 }),
  ]));
  expect(result.actions?.[0]?.attempts.at(0)?.attempt).toBe(1);
  expect(result.results[0]?.attempts).toBe(2);
  expect(result.results[0]?.state).toBe("success");
});

test("RPADriver stops retrying after non-retryable command failure", async () => {
  const driver = new RPADriver();
  let attempt = 0;

  const result = await driver.executeFlow({
    version: FLOW_VERSION,
    appId: "com.vertu.edge",
    steps: [{ type: "launchApp" }],
  }, {
    maxAttempts: 3,
    commandRunner: async (_script, _timeoutMs, command) => {
      attempt += 1;
      return {
        state: "error",
        message: "permanent failure",
        error: createFlowCapabilityError({
          commandIndex: 0,
          command: command.type,
          commandType: command.type,
          reason: "permanent failure",
          retryable: false,
          surface: "flow",
        }),
      };
    },
  });

  expect(result.state).toBe("error-non-retryable");
  expect(attempt).toBe(1);
  expect(result.results[0]?.attempts).toBe(1);
  expect(result.actions?.[0]?.attempts.length).toBe(1);
  expect(result.actions?.[0]?.attempts.at(0)?.state).toBe("error");
  expect(result.actions?.[0]?.attempts.at(0)?.message).toBe("permanent failure");
});

test("getFlowTargetCapabilityProbe returns android target for android", () => {
  const probe = getFlowTargetCapabilityProbe("android");
  expect(probe.target).toBe("android");
  expect(probe.supportsCommand("screenshot")).toBe(true);
});

test("Flow android vs osx target capability supports differ for tapOn", () => {
  const androidProbe = getFlowTargetCapabilityProbe("android");
  const osxProbe = getFlowTargetCapabilityProbe("osx");
  expect(androidProbe.supportsCommand("tapOn")).toBe(true);
  expect(osxProbe.supportsCommand("tapOn")).toBe(false);
});

test("iOS capability probe returns explicit non-retryable readiness failure", async () => {
  const probe = getFlowTargetCapabilityProbe("ios");
  const readinessFailure = await probe.validateTargetReady();
  expect(readinessFailure).not.toBeNull();
  expect(readinessFailure?.retryable).toBe(false);
  expect(readinessFailure?.command).toBe("target");
  expect(readinessFailure?.reason).toMatch(/iOS target is not ready/);
});

test("iOS command support matrix is updated for parity with runtime expectations", () => {
  const probe = getFlowTargetCapabilityProbe("ios");

  expect(probe.supportsCommand("assertVisible")).toBe(true);
  expect(probe.supportsCommand("assertNotVisible")).toBe(true);
  expect(probe.supportsCommand("assertText")).toBe(true);
  expect(probe.supportsCommand("scroll")).toBe(true);
  expect(probe.supportsCommand("swipe")).toBe(true);
  expect(probe.supportsCommand("selectOption")).toBe(true);
  expect(probe.supportsCommand("hideKeyboard")).toBe(true);
  expect(probe.supportsCommand("clipboardWrite")).toBe(true);
  expect(probe.supportsCommand("clipboardRead")).toBe(false);
  expect(probe.supportsCommand("windowFocus")).toBe(false);
});

test("analyzeAutomationStep accepts selector-based tapOn and selector/object targets", () => {
  expect(analyzeAutomationStep({ tapOn: "Login" }, 0)).toEqual({
    index: 0,
    commandType: "tapOn",
    supported: true,
  });
  expect(analyzeAutomationStep({ tapOn: { text: "Login" } }, 1)).toEqual({
    index: 1,
    commandType: "tapOn",
    supported: true,
  });
  expect(analyzeAutomationStep({ tapOn: { x: 10 } }, 2)).toEqual({
    index: 2,
    commandType: "tapOn",
    supported: false,
    reason: "tapOn object must contain a recognized selector (text, resourceId, contentDescription).",
  });
});

test("analyzeAutomationCommand accepts new scalar and object forms", () => {
  expect(analyzeAutomationStep({ assertText: "title::expected" }, 0)).toEqual({ index: 0, commandType: "assertText", supported: true });
  expect(analyzeAutomationStep({ selectOption: "title::English" }, 1)).toEqual({ index: 1, commandType: "selectOption", supported: true });
  expect(analyzeAutomationStep({ windowFocus: "title=Finder" }, 2)).toEqual({ index: 2, commandType: "windowFocus", supported: true });
  expect(analyzeAutomationStep({ clipboardWrite: "abc" }, 3)).toEqual({ index: 3, commandType: "clipboardWrite", supported: true });
});
