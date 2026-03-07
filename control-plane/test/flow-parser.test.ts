import { expect, test, describe } from "bun:test";
import { parseMaestroFlowYaml } from "../../contracts/flow-parser";
import type { FlowCapabilityError } from "../../contracts/flow-contracts";

function expectFlowError(fn: () => unknown, reasonSubstring: string): void {
  try {
    fn();
    throw new Error("Expected FlowCapabilityError but none was thrown");
  } catch (e: unknown) {
    const error = e as FlowCapabilityError;
    expect(error.reason).toBeDefined();
    expect(error.reason).toContain(reasonSubstring);
  }
}

describe("parseMaestroFlowYaml", () => {
  test("parses a single-document flow", () => {
    const yaml = `
appId: com.example.app
version: "1.0"
steps:
  - launchApp
  - tapOn: "Submit"
`;
    const flow = parseMaestroFlowYaml(yaml);
    expect(flow.appId).toBe("com.example.app");
    expect(flow.version).toBe("1.0");
    expect(flow.steps).toHaveLength(2);
    expect(flow.steps[0]).toEqual({ type: "launchApp" });
    expect(flow.steps[1]).toEqual({ type: "tapOn", target: { text: "Submit" } });
  });

  test("parses two-document Maestro format", () => {
    const yaml = `---
appId: com.example.app
version: "1.0"
---
- launchApp
- screenshot
`;
    const flow = parseMaestroFlowYaml(yaml);
    expect(flow.appId).toBe("com.example.app");
    expect(flow.steps).toHaveLength(2);
    expect(flow.steps[0]).toEqual({ type: "launchApp" });
    expect(flow.steps[1]).toEqual({ type: "screenshot" });
  });

  test("rejects empty input", () => {
    expectFlowError(() => parseMaestroFlowYaml(""), "empty");
  });

  test("rejects whitespace-only input", () => {
    expectFlowError(() => parseMaestroFlowYaml("   \n  \n  "), "empty");
  });

  test("rejects more than 2 documents", () => {
    const yaml = `---
appId: com.example.app
version: "1.0"
---
- launchApp
---
- screenshot
`;
    expectFlowError(() => parseMaestroFlowYaml(yaml), "single document or config+commands");
  });

  test("rejects malformed YAML syntax", () => {
    const yaml = `
appId: com.example.app
version: "1.0"
steps:
  - : : : invalid yaml [[[
`;
    expectFlowError(() => parseMaestroFlowYaml(yaml), "YAML parse error");
  });

  test("rejects missing appId", () => {
    const yaml = `
version: "1.0"
steps:
  - launchApp
`;
    expectFlowError(() => parseMaestroFlowYaml(yaml), "appId");
  });

  test("rejects missing version", () => {
    const yaml = `
appId: com.example.app
steps:
  - launchApp
`;
    expectFlowError(() => parseMaestroFlowYaml(yaml), "version");
  });

  test("rejects unsupported version", () => {
    const yaml = `
appId: com.example.app
version: "2.0"
steps:
  - launchApp
`;
    expectFlowError(() => parseMaestroFlowYaml(yaml), "Unsupported flow version");
  });

  test("accepts numeric version 1", () => {
    const yaml = `
appId: com.example.app
version: 1
steps:
  - launchApp
`;
    const flow = parseMaestroFlowYaml(yaml);
    expect(flow.version).toBe("1.0");
  });

  test("rejects non-array steps", () => {
    const yaml = `
appId: com.example.app
version: "1.0"
steps: "not-an-array"
`;
    expectFlowError(() => parseMaestroFlowYaml(yaml), "steps must be an array");
  });

  test("rejects unsupported scalar command", () => {
    const yaml = `
appId: com.example.app
version: "1.0"
steps:
  - unknownCommand
`;
    expectFlowError(() => parseMaestroFlowYaml(yaml), "Unsupported scalar command");
  });

  test("rejects unsupported step type", () => {
    const yaml = `
appId: com.example.app
version: "1.0"
steps:
  - type: fooBar
`;
    expectFlowError(() => parseMaestroFlowYaml(yaml), "Unsupported step type");
  });

  test("rejects null step", () => {
    const yaml = `
appId: com.example.app
version: "1.0"
steps:
  - null
`;
    expectFlowError(() => parseMaestroFlowYaml(yaml), "must be an object or string command");
  });
});

describe("step normalization", () => {
  function parseSteps(stepsYaml: string) {
    return parseMaestroFlowYaml(`
appId: com.test
version: "1.0"
steps:
${stepsYaml}
`);
  }

  test("tapOn with text target", () => {
    const flow = parseSteps("  - tapOn: Submit");
    expect(flow.steps[0]).toEqual({ type: "tapOn", target: { text: "Submit" } });
  });

  test("tapOn with resourceId target", () => {
    const flow = parseSteps("  - tapOn: id=com.example:id/btn");
    expect(flow.steps[0]).toEqual({
      type: "tapOn",
      target: { resourceId: "com.example:id/btn" },
    });
  });

  test("tapOn with coordinate target", () => {
    const flow = parseSteps("  - tapOn: 100,200");
    expect(flow.steps[0]).toEqual({ type: "tapOn", target: { x: 100, y: 200 } });
  });

  test("tapOn with contentDescription target", () => {
    const flow = parseSteps("  - tapOn: contentDescription=Close dialog");
    expect(flow.steps[0]).toEqual({
      type: "tapOn",
      target: { contentDescription: "Close dialog" },
    });
  });

  test("inputText with value", () => {
    const flow = parseSteps('  - inputText: "hello world"');
    expect(flow.steps[0]).toEqual({ type: "inputText", value: "hello world" });
  });

  test("assertVisible with text target", () => {
    const flow = parseSteps("  - assertVisible: Welcome");
    expect(flow.steps[0]).toEqual({ type: "assertVisible", target: { text: "Welcome" } });
  });

  test("assertNotVisible with text target", () => {
    const flow = parseSteps("  - assertNotVisible: Error");
    expect(flow.steps[0]).toEqual({ type: "assertNotVisible", target: { text: "Error" } });
  });

  test("assertText with scalar syntax", () => {
    const flow = parseSteps("  - assertText: Submit::Submit Order");
    expect(flow.steps[0]).toEqual({
      type: "assertText",
      target: { text: "Submit" },
      value: "Submit Order",
    });
  });

  test("selectOption with scalar syntax", () => {
    const flow = parseSteps("  - selectOption: Country::France");
    expect(flow.steps[0]).toEqual({
      type: "selectOption",
      target: { text: "Country" },
      option: "France",
    });
  });

  test("scroll with direction", () => {
    const flow = parseSteps("  - scroll: down");
    expect(flow.steps[0]).toEqual({ type: "scroll", direction: "DOWN" });
  });

  test("swipe with direction", () => {
    const flow = parseSteps("  - swipe: left");
    expect(flow.steps[0]).toEqual({ type: "swipe", direction: "LEFT" });
  });

  test("clipboardWrite with value", () => {
    const flow = parseSteps("  - clipboardWrite: copied-text");
    expect(flow.steps[0]).toEqual({ type: "clipboardWrite", value: "copied-text" });
  });

  test("windowFocus with title", () => {
    const flow = parseSteps("  - windowFocus: My App");
    expect(flow.steps[0]).toEqual({ type: "windowFocus", target: { title: "My App" } });
  });

  test("windowFocus with appId= syntax", () => {
    const flow = parseSteps("  - windowFocus: appId=com.example.app|title=Main");
    expect(flow.steps[0]).toEqual({
      type: "windowFocus",
      target: { appId: "com.example.app", title: "Main" },
    });
  });

  test("waitForAnimation with timeoutMs", () => {
    const flow = parseSteps("  - waitForAnimation: 500");
    expect(flow.steps[0]).toEqual({ type: "waitForAnimation", timeoutMs: 500 });
  });

  test("hideKeyboard scalar", () => {
    const flow = parseSteps("  - hideKeyboard");
    expect(flow.steps[0]).toEqual({ type: "hideKeyboard" });
  });

  test("screenshot scalar", () => {
    const flow = parseSteps("  - screenshot");
    expect(flow.steps[0]).toEqual({ type: "screenshot" });
  });

  test("clipboardRead scalar", () => {
    const flow = parseSteps("  - clipboardRead");
    expect(flow.steps[0]).toEqual({ type: "clipboardRead" });
  });
});

describe("typed step normalization", () => {
  function parseSteps(stepsYaml: string) {
    return parseMaestroFlowYaml(`
appId: com.test
version: "1.0"
steps:
${stepsYaml}
`);
  }

  test("typed tapOn with object target", () => {
    const flow = parseSteps(`  - type: tapOn
    target:
      resourceId: "com.example:id/btn"
      text: Submit`);
    expect(flow.steps[0]).toEqual({
      type: "tapOn",
      target: { resourceId: "com.example:id/btn", text: "Submit" },
    });
  });

  test("typed scroll with steps count", () => {
    const flow = parseSteps(`  - type: scroll
    direction: up
    steps: 3`);
    expect(flow.steps[0]).toEqual({ type: "scroll", direction: "UP", steps: 3 });
  });

  test("typed swipe with distanceFraction", () => {
    const flow = parseSteps(`  - type: swipe
    direction: right
    distanceFraction: 0.5`);
    expect(flow.steps[0]).toEqual({
      type: "swipe",
      direction: "RIGHT",
      distanceFraction: 0.5,
    });
  });

  test("rejects swipe with out-of-range distanceFraction", () => {
    expectFlowError(
      () =>
        parseSteps(`  - type: swipe
    direction: right
    distanceFraction: 1.5`),
      "distanceFraction invalid",
    );
  });

  test("rejects extra keys on typed step", () => {
    expectFlowError(
      () =>
        parseSteps(`  - type: launchApp
    extraField: value`),
      "unsupported fields",
    );
  });

  test("typed assertText with target and value", () => {
    const flow = parseSteps(`  - type: assertText
    target:
      text: Price
    value: "$9.99"`);
    expect(flow.steps[0]).toEqual({
      type: "assertText",
      target: { text: "Price" },
      value: "$9.99",
    });
  });

  test("rejects assertText with empty value", () => {
    expectFlowError(
      () =>
        parseSteps(`  - type: assertText
    target:
      text: Price
    value: "  "`),
      "must not be empty",
    );
  });

  test("typed windowFocus with object target", () => {
    const flow = parseSteps(`  - type: windowFocus
    target:
      appId: com.example
      title: Main Window`);
    expect(flow.steps[0]).toEqual({
      type: "windowFocus",
      target: { appId: "com.example", title: "Main Window" },
    });
  });

  test("typed waitForAnimation with timeoutMs", () => {
    const flow = parseSteps(`  - type: waitForAnimation
    timeoutMs: 1000`);
    expect(flow.steps[0]).toEqual({ type: "waitForAnimation", timeoutMs: 1000 });
  });
});

describe("target validation", () => {
  function parseSteps(stepsYaml: string) {
    return parseMaestroFlowYaml(`
appId: com.test
version: "1.0"
steps:
${stepsYaml}
`);
  }

  test("rejects empty target string", () => {
    expectFlowError(
      () => parseSteps('  - tapOn: ""'),
      "must not be empty",
    );
  });

  test("rejects target with empty resourceId", () => {
    expectFlowError(
      () =>
        parseSteps(`  - type: tapOn
    target:
      resourceId: ""`),
      "must not be empty",
    );
  });

  test("rejects target with no selector fields", () => {
    expectFlowError(
      () =>
        parseSteps(`  - type: assertVisible
    target:
      x: 100`),
      "selector target must include resourceId, text, or contentDescription",
    );
  });

  test("rejects target with unsupported fields", () => {
    expectFlowError(
      () =>
        parseSteps(`  - type: tapOn
    target:
      text: Submit
      unknownProp: value`),
      "unsupported",
    );
  });
});
