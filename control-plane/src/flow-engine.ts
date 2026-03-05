import { dirname, join } from "path";
import { mkdir } from "fs/promises";
import {
  type FlowCapabilityError,
  type FlowCommand,
  type FlowCommandExecutionState,
  type FlowCommandResult,
  type FlowRunAction,
  type FlowRunPolicy,
  type FlowRunResult,
  type FlowRunState,
  type FlowRunTarget,
  type FlowV1,
  type FlowCapabilityRequirement,
  type FlowCommandCapability,
  type CommandTarget,
  type FlowCapabilityMatrix,
  type ArtifactMetadata,
  SUPPORTED_FLOW_COMMAND_SET,
  createFlowCapabilityError,
} from "../../contracts/flow-contracts";
import {
  DEFAULT_FLOW_TARGET,
  FLOW_RUN_COMMAND_TIMEOUT_MS,
  FLOW_ADAPTER_COMMAND_TIMEOUT_MS,
  FLOW_RUN_MAX_ATTEMPTS,
  FLOW_RUN_RETRY_DELAY_MS,
} from "./config";

const FLOW_ARTIFACT_PREFIX = "vertu-flow";

const DEFAULT_ADAPTER_COMMAND_TIMEOUT_MS = FLOW_ADAPTER_COMMAND_TIMEOUT_MS;
const ANDROID_COMMAND = "adb";
const IOS_COMMAND = "xcrun";

export type CommandRunner = (
  _script: string,
  _timeoutMs: number,
  command: FlowCommand,
) => Promise<{ state: FlowCommandExecutionState; message: string; error?: FlowCapabilityError }>;

type FlowExecutionOptions = {
  target?: FlowRunTarget;
  maxAttempts?: number;
  commandTimeoutMs?: number;
  retryDelayMs?: number;
  correlationId?: string;
  /** Test-only: override adapter command execution. When set, used instead of adapter.executeCommand. */
  commandRunner?: CommandRunner;
};

export interface FlowTargetCapabilityProbe {
  readonly target: FlowRunTarget;
  supportsCommand: (commandType: FlowCommand["type"]) => boolean;
  validateTargetReady: () => Promise<FlowCapabilityError | null>;
  listRequirements: () => Promise<FlowCapabilityRequirement[]>;
}

export function getFlowTargetCapabilityProbe(target: FlowRunTarget = DEFAULT_FLOW_TARGET): FlowTargetCapabilityProbe {
  const adapter = createAdapter(target);
  return {
    target: adapter.target,
    supportsCommand: adapter.supportsCommand.bind(adapter),
    validateTargetReady: () => adapter.validateTargetReady(),
    listRequirements: () => adapter.listRequirements(),
  };
}

export async function getFlowCapabilityMatrix(target: FlowRunTarget = DEFAULT_FLOW_TARGET): Promise<FlowCapabilityMatrix> {
  const adapter = createAdapter(target);
  const requirements = await adapter.listRequirements();
  const readinessError = await adapter.validateTargetReady();
  const commands: FlowCommandCapability[] = [...SUPPORTED_FLOW_COMMAND_SET].map((commandType) => ({
    commandType,
    supported: adapter.supportsCommand(commandType),
    reason: adapter.supportsCommand(commandType)
      ? undefined
      : `${commandType} is not supported on ${adapter.target}`,
  }));

  return {
    target: adapter.target,
    ready: readinessError === null,
    commands,
    requirements,
  };
}

export interface FlowExecutionHooks {
  onCommandStart?: (context: {
    commandIndex: number;
    commandType: FlowCommand["type"];
    attempt: number;
    target: FlowRunTarget;
    command: FlowCommand;
  }) => void | Promise<void>;
  onCommandComplete?: (context: {
    commandIndex: number;
    commandType: FlowCommand["type"];
    attempt: number;
    target: FlowRunTarget;
    command: FlowCommand;
    result: FlowCommandResult;
  }) => void | Promise<void>;
}

interface RpaTargetAdapter {
  readonly target: FlowRunTarget;
  listRequirements(): Promise<FlowCapabilityRequirement[]>;
  validateTargetReady(): Promise<FlowCapabilityError | null>;
  supportsCommand(commandType: FlowCommand["type"]): boolean;
  executeCommand(command: FlowCommand, appId: string, timeoutMs: number, correlationId: string): Promise<CommandExecutionResult>;
}

type CommandExecutionResult = Omit<FlowCommandResult, "commandIndex" | "commandType" | "attempts">;

function resolvePolicy(options: FlowExecutionOptions): FlowRunPolicy {
  const maxAttempts = options.maxAttempts ?? FLOW_RUN_MAX_ATTEMPTS;
  const commandTimeoutMs = options.commandTimeoutMs ?? FLOW_RUN_COMMAND_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? FLOW_RUN_RETRY_DELAY_MS;
  return {
    maxAttempts: maxAttempts > 0 ? maxAttempts : FLOW_RUN_MAX_ATTEMPTS,
    commandTimeoutMs: commandTimeoutMs > 0 ? commandTimeoutMs : FLOW_RUN_COMMAND_TIMEOUT_MS,
    retryDelayMs: retryDelayMs > 0 ? retryDelayMs : FLOW_RUN_RETRY_DELAY_MS,
  };
}

export class RPADriver {
  public hooks?: FlowExecutionHooks;

  async executeFlow(flow: FlowV1, options: FlowExecutionOptions = {}): Promise<FlowRunResult> {
    const target = options.target ?? DEFAULT_FLOW_TARGET;
    const adapter = createAdapter(target);
    const policy = resolvePolicy(options);
    const correlationId = options.correlationId ?? createCorrelationId();

    const startedAt = Date.now();
    const actions: FlowRunAction[] = [];
    const results: FlowCommandResult[] = [];

    const readinessFailure = options.commandRunner ? null : await adapter.validateTargetReady();
    if (readinessFailure) {
      return {
        appId: flow.appId,
        commandCount: flow.steps.length,
        target: adapter.target,
        policy,
        actions,
        results: [{
          commandIndex: 0,
          commandType: "launchApp",
          state: "error",
          attempts: 1,
          message: readinessFailure.reason,
          error: readinessFailure,
        }],
        state: readinessFailure.retryable ? "error-retryable" : "error-non-retryable",
        durationMs: Date.now() - startedAt,
      };
    }

    let runState: FlowRunState = "success";
    for (const [commandIndex, command] of flow.steps.entries()) {
      const action: FlowRunAction = {
        commandIndex,
        commandType: command.type,
        target: adapter.target,
        attempts: [],
      };

      if (!SUPPORTED_FLOW_COMMAND_SET.has(command.type)) {
        const unsupported = createUnsupportedCommandResult(commandIndex, command.type, adapter.target, correlationId);
        actions.push(action);
        results.push(unsupported);
        runState = "error-non-retryable";
        break;
      }

      if (!adapter.supportsCommand(command.type)) {
        const unsupported = createUnsupportedCommandResult(commandIndex, command.type, adapter.target, correlationId);
        actions.push(action);
        results.push(unsupported);
        runState = "error-non-retryable";
        break;
      }

      const commandResult = await this.executeCommandWithPolicy(
        adapter,
        flow.appId,
        command,
        commandIndex,
        correlationId,
        policy,
        action,
        options.commandRunner,
      );

      actions.push(action);
      results.push(commandResult);
      if (commandResult.state !== "success") {
        runState = commandResult.error?.retryable ? "error-retryable" : "error-non-retryable";
        break;
      }
    }

    return {
      appId: flow.appId,
      commandCount: flow.steps.length,
      target: adapter.target,
      policy,
      actions,
      results,
      state: runState,
      durationMs: Date.now() - startedAt,
    };
  }

  private async executeCommandWithPolicy(
    adapter: RpaTargetAdapter,
    appId: string,
    command: FlowCommand,
    commandIndex: number,
    correlationId: string,
    policy: FlowRunPolicy,
    action: FlowRunAction,
    commandRunner?: CommandRunner,
  ): Promise<FlowCommandResult> {
    let attempts = 0;
    let lastFailure: FlowCapabilityError | undefined;

    for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
      attempts = attempt;
      const start = Date.now();
      await this.hooks?.onCommandStart?.({
        commandIndex,
        commandType: command.type,
        attempt,
        target: adapter.target,
        command,
      });

      const result = commandRunner
        ? await commandRunner("", policy.commandTimeoutMs, command).then((r) => ({
            state: r.state,
            message: r.message,
            error: r.error,
          }))
        : await adapter.executeCommand(command, appId, policy.commandTimeoutMs, correlationId);
      const end = Date.now();
      action.attempts.push({
        commandIndex,
        attempt,
        state: result.state,
        message: result.message,
        startedAt: new Date(start).toISOString(),
        endedAt: new Date(end).toISOString(),
        durationMs: Math.max(0, end - start),
        error: result.error,
      });

      const normalizedResult: FlowCommandResult = {
        ...result,
        commandIndex,
        commandType: command.type,
        attempts,
      };

      await this.hooks?.onCommandComplete?.({
        commandIndex,
        commandType: command.type,
        attempt,
        target: adapter.target,
        command,
        result: normalizedResult,
      });

      if (normalizedResult.state === "success") {
        return normalizedResult;
      }

      lastFailure = normalizedResult.error;
      const shouldRetry = attempt < policy.maxAttempts && (normalizedResult.error?.retryable ?? false);
      if (!shouldRetry) {
        return normalizedResult;
      }

      // Cap the retry delay at 30 seconds to prevent unbounded backoff growth.
      const MAX_RETRY_DELAY_MS = 30_000;
      await wait(Math.min(policy.retryDelayMs * attempt, MAX_RETRY_DELAY_MS));
    }

    const fallbackError = lastFailure ?? createFlowCapabilityError({
      commandIndex,
      command: command.type,
      code: "FLOW_COMMAND_FAILED",
      category: "runtime",
      reason: `${command.type} failed after ${attempts} attempts`,
      retryable: false,
      correlationId,
      surface: "flow",
      resource: adapter.target,
    });

    return {
      commandIndex,
      commandType: command.type,
      attempts,
      state: "error",
      message: fallbackError.reason,
      error: fallbackError,
    };
  }
}

function createUnsupportedCommandResult(
  commandIndex: number,
  commandType: FlowCommand["type"],
  target: FlowRunTarget,
  correlationId: string,
): FlowCommandResult {
  const error = createFlowCapabilityError({
    commandIndex,
    command: commandType,
    commandType,
    code: "FLOW_COMMAND_UNSUPPORTED",
    category: "unsupported",
    reason: `Unsupported command: ${commandType} on ${target}`,
    retryable: false,
    correlationId,
    surface: "flow",
    resource: target,
  });

  return {
    commandIndex,
    commandType,
    state: "unsupported",
    attempts: 0,
    message: error.reason,
    error,
  };
}

function createAdapter(target: FlowRunTarget): RpaTargetAdapter {
  if (target === "android") return new AndroidAdapter();
  if (target === "ios") return new IosAdapter();
  if (target === "osx") return new DesktopAdapter("osx");
  if (target === "windows") return new DesktopAdapter("windows");
  return new DesktopAdapter("linux");
}

class AndroidAdapter implements RpaTargetAdapter {
  public readonly target: FlowRunTarget = "android";
  private readonly supported = new Set<FlowCommand["type"]>([
    "launchApp",
    "tapOn",
    "inputText",
    "assertVisible",
    "assertNotVisible",
    "assertText",
    "scroll",
    "swipe",
    "screenshot",
    "hideKeyboard",
    "waitForAnimation",
    "selectOption",
  ]);

  public supportsCommand(commandType: FlowCommand["type"]): boolean {
    return this.supported.has(commandType);
  }

  public async listRequirements(): Promise<FlowCapabilityRequirement[]> {
    const adbAvailable = await isCommandAvailable(ANDROID_COMMAND, ["version"]);
    const connectedDevice = adbAvailable ? (await listAdbDevices()).length > 0 : false;
    return [
      {
        id: "adb",
        description: "Android Debug Bridge (adb) is installed and available on PATH",
        required: true,
        installed: adbAvailable,
      },
      {
        id: "android_device",
        description: "At least one Android device/emulator is connected",
        required: true,
        installed: connectedDevice,
      },
    ];
  }

  public async validateTargetReady(): Promise<FlowCapabilityError | null> {
    const requirements = await this.listRequirements();
    const missing = requirements.find((requirement) => requirement.required && !requirement.installed);
    if (!missing) {
      return null;
    }

    return createFlowCapabilityError({
      commandIndex: 0,
      command: "target",
      code: "ANDROID_TARGET_NOT_READY",
      category: "dependency",
      reason: `Android target is not ready: ${missing.description}`,
      retryable: missing.id === "android_device",
      surface: "flow",
      resource: missing.id,
    });
  }

  public async executeCommand(
    command: FlowCommand,
    appId: string,
    timeoutMs: number,
    correlationId: string,
  ): Promise<CommandExecutionResult> {
    if (command.type === "waitForAnimation") {
      await wait(command.timeoutMs ?? 600);
      return { state: "success", message: "waitForAnimation executed successfully" };
    }

    if (command.type === "launchApp") {
      const launch = await spawnText(ANDROID_COMMAND, ["shell", "monkey", "-p", appId, "-c", "android.intent.category.LAUNCHER", "1"], timeoutMs);
      if (!launch.ok) {
        return asCommandFailure(command.type, launch.error, correlationId, "runtime", true);
      }
      return { state: "success", message: "launchApp executed successfully" };
    }

    if (command.type === "tapOn") {
      if (hasTapCoordinates(command.target)) {
        const tap = await spawnText(ANDROID_COMMAND, ["shell", "input", "tap", String(command.target.x), String(command.target.y)], timeoutMs);
        if (!tap.ok) {
          return asCommandFailure(command.type, tap.error, correlationId, "runtime", true);
        }
        return { state: "success", message: "tapOn executed successfully" };
      }

      if (!hasTapSelector(command.target)) {
        return unsupportedForSelector(command.type, "tapOn requires x/y coordinates or a selector target on Android adapter", correlationId);
      }

      const resolved = await resolveTapTargetCoordinates(command.target, timeoutMs);
      if (!resolved.ok) {
        return unsupportedForSelector(command.type, resolved.reason, correlationId);
      }

      const tap = await spawnText(ANDROID_COMMAND, ["shell", "input", "tap", String(resolved.x), String(resolved.y)], timeoutMs);
      if (!tap.ok) {
        return asCommandFailure(command.type, tap.error, correlationId, "runtime", true);
      }
      return { state: "success", message: "tapOn executed successfully" };
    }

    if (command.type === "inputText") {
      // adb shell `input text` treats `%s` as a space and `%%` as a literal `%`.
      // Encode literal `%` first, then encode whitespace as `%s` so that neither
      // the percent sign itself nor any other whitespace triggers adb escaping bugs.
      const sanitized = command.value.replace(/%/g, "%%").replace(/\s/g, "%s");
      const input = await spawnText(ANDROID_COMMAND, ["shell", "input", "text", sanitized], timeoutMs);
      if (!input.ok) {
        return asCommandFailure(command.type, input.error, correlationId, "runtime", true);
      }
      return { state: "success", message: "inputText executed successfully" };
    }

    if (command.type === "hideKeyboard") {
      const hide = await spawnText(ANDROID_COMMAND, ["shell", "input", "keyevent", "111"], timeoutMs);
      if (!hide.ok) {
        return asCommandFailure(command.type, hide.error, correlationId, "runtime", false);
      }
      return { state: "success", message: "hideKeyboard executed successfully" };
    }

    if (command.type === "scroll" || command.type === "swipe") {
      const swipe = await performAndroidSwipe(command, timeoutMs);
      if (!swipe.ok) {
        return asCommandFailure(command.type, swipe.error, correlationId, "runtime", true);
      }
      return { state: "success", message: `${command.type} executed successfully` };
    }

    if (command.type === "screenshot") {
      const artifactPath = await captureAndroidScreenshot(correlationId, timeoutMs);
      if (!artifactPath.ok) {
        return asCommandFailure(command.type, artifactPath.error, correlationId, "runtime", true);
      }
      const artifact = await buildArtifactMetadata(artifactPath.path, correlationId, "image/png");
      return {
        state: "success",
        message: `Screenshot saved to ${artifactPath.path}`,
        artifactPath: artifactPath.path,
        artifact,
      };
    }

    if (command.type === "assertVisible" || command.type === "assertNotVisible" || command.type === "assertText") {
      const assertion = await runAndroidAssertion(command, timeoutMs);
      if (!assertion.ok) {
        return asCommandFailure(command.type, assertion.error, correlationId, "validation", false);
      }
      return { state: "success", message: `${command.type} executed successfully` };
    }

    if (command.type === "selectOption") {
      // selectOption is implemented as a tap + inputText. Use a flat call to executeCommand
      // for each sub-step with explicit types that cannot re-trigger selectOption,
      // preventing any possibility of infinite recursion.
      const tapCommand: FlowCommand = { type: "tapOn", target: command.target };
      const select = await this.executeCommand(tapCommand, appId, timeoutMs, correlationId);
      if (select.state !== "success") {
        return select;
      }
      const inputCommand: FlowCommand = { type: "inputText", value: command.option };
      return this.executeCommand(inputCommand, appId, timeoutMs, correlationId);
    }

    return unsupportedForSelector(command.type, `${command.type} is unsupported on android adapter`, correlationId);
  }
}

class IosAdapter implements RpaTargetAdapter {
  public readonly target: FlowRunTarget = "ios";
  private readonly supported = new Set<FlowCommand["type"]>([
    "launchApp",
    "tapOn",
    "inputText",
    "assertVisible",
    "assertNotVisible",
    "assertText",
    "scroll",
    "swipe",
    "selectOption",
    "screenshot",
    "clipboardWrite",
    "hideKeyboard",
    "waitForAnimation",
  ]);

  public supportsCommand(commandType: FlowCommand["type"]): boolean {
    return this.supported.has(commandType);
  }

  public async listRequirements(): Promise<FlowCapabilityRequirement[]> {
    const hostOk = process.platform === "darwin";
    const xcrunAvailable = hostOk ? await isCommandAvailable(IOS_COMMAND, ["simctl", "list"]) : false;
    const bootedAvailable = hostOk && xcrunAvailable ? await hasBootedIosSimulator() : false;

    return [
      {
        id: "macos",
        description: "iOS automation requires macOS host",
        required: true,
        installed: hostOk,
      },
      {
        id: "xcrun",
        description: "xcrun/simctl is available",
        required: true,
        installed: xcrunAvailable,
      },
      {
        id: "ios_simulator_booted",
        description: "At least one iOS simulator is booted",
        required: true,
        installed: bootedAvailable,
      },
    ];
  }

  public async validateTargetReady(): Promise<FlowCapabilityError | null> {
    const missing = (await this.listRequirements()).find((requirement) => requirement.required && !requirement.installed);
    if (!missing) {
      return null;
    }

    return createFlowCapabilityError({
      commandIndex: 0,
      command: "target",
      code: "IOS_TARGET_NOT_READY",
      category: "dependency",
      reason: `iOS target is not ready: ${missing.description}`,
      retryable: missing.id === "ios_simulator_booted",
      surface: "flow",
      resource: missing.id,
    });
  }

  public async executeCommand(
    command: FlowCommand,
    appId: string,
    timeoutMs: number,
    correlationId: string,
  ): Promise<CommandExecutionResult> {
    if (command.type === "waitForAnimation") {
      await wait(command.timeoutMs ?? 600);
      return { state: "success", message: "waitForAnimation executed successfully" };
    }

    if (command.type === "launchApp") {
      const launched = await spawnText(IOS_COMMAND, ["simctl", "launch", "booted", appId], timeoutMs);
      if (!launched.ok) {
        return asCommandFailure(command.type, launched.error, correlationId, "runtime", true);
      }
      return { state: "success", message: "launchApp executed successfully" };
    }

    if (command.type === "tapOn") {
      if (hasTapCoordinates(command.target)) {
        const tapped = await spawnText(IOS_COMMAND, ["simctl", "io", "booted", "tap", String(command.target.x), String(command.target.y)], timeoutMs);
        if (!tapped.ok) {
          return asCommandFailure(command.type, tapped.error, correlationId, "runtime", true);
        }
        return { state: "success", message: "tapOn executed successfully" };
      }

      if (!hasTapSelector(command.target)) {
        return unsupportedForSelector(command.type, "tapOn requires x/y coordinates or a selector target on iOS adapter", correlationId);
      }

      return unsupportedForSelector(command.type, "tapOn selector execution is not implemented in control-plane iOS CLI adapter", correlationId);
    }

    if (command.type === "inputText") {
      const typed = await spawnText(IOS_COMMAND, ["simctl", "io", "booted", "keyboard", "text", command.value], timeoutMs);
      if (!typed.ok) {
        return asCommandFailure(command.type, typed.error, correlationId, "runtime", true);
      }
      return { state: "success", message: "inputText executed successfully" };
    }

    if (command.type === "screenshot") {
      const artifactPath = join(await ensureArtifactDirectory(), `${FLOW_ARTIFACT_PREFIX}-ios-${Date.now()}.png`);
      const captured = await spawnText(IOS_COMMAND, ["simctl", "io", "booted", "screenshot", artifactPath], timeoutMs);
      if (!captured.ok) {
        return asCommandFailure(command.type, captured.error, correlationId, "runtime", true);
      }
      const artifact = await buildArtifactMetadata(artifactPath, correlationId, "image/png");
      return {
        state: "success",
        message: `Screenshot saved to ${artifactPath}`,
        artifactPath,
        artifact,
      };
    }

    if (
      command.type === "assertVisible" ||
      command.type === "assertNotVisible" ||
      command.type === "assertText" ||
      command.type === "selectOption" ||
      command.type === "scroll" ||
      command.type === "swipe" ||
      command.type === "hideKeyboard"
    ) {
      return unsupportedForSelector(
        command.type,
        "iOS CLI adapter does not yet execute this command directly; use a dedicated iOS runtime.",
        correlationId,
      );
    }

    if (command.type === "clipboardWrite") {
      return unsupportedForSelector(
        command.type,
        "clipboardWrite is not available in the control-plane iOS CLI adapter.",
        correlationId,
      );
    }

    return unsupportedForSelector(command.type, `${command.type} is unsupported on iOS adapter`, correlationId);
  }
}

class DesktopAdapter implements RpaTargetAdapter {
  public readonly target: FlowRunTarget;
  private readonly hostPlatform: NodeJS.Platform;

  constructor(target: "osx" | "windows" | "linux") {
    this.target = target;
    this.hostPlatform = process.platform;
  }

  private matchesHost(): boolean {
    if (this.target === "osx") return this.hostPlatform === "darwin";
    if (this.target === "windows") return this.hostPlatform === "win32";
    return this.hostPlatform === "linux";
  }

  public supportsCommand(commandType: FlowCommand["type"]): boolean {
    if (commandType === "waitForAnimation") return true;
    if (commandType === "screenshot") return true;
    if (commandType === "clipboardRead") return true;
    if (commandType === "clipboardWrite") return true;
    if (commandType === "windowFocus") return true;
    if (commandType === "launchApp") return true;
    return false;
  }

  public async listRequirements(): Promise<FlowCapabilityRequirement[]> {
    const requirements: FlowCapabilityRequirement[] = [
      {
        id: "host_os_match",
        description: `Target ${this.target} requires matching host OS`,
        required: true,
        installed: this.matchesHost(),
      },
    ];

    if (this.target === "osx") {
      requirements.push({
        id: "screencapture",
        description: "screencapture command is available",
        required: true,
        installed: this.matchesHost() ? await isCommandAvailable("screencapture", ["-h"]) : false,
      });
      requirements.push({
        id: "pbcopy",
        description: "pbcopy/pbpaste commands are available",
        required: true,
        installed: this.matchesHost()
          ? (await isCommandAvailable("pbcopy", ["-help"])) && (await isCommandAvailable("pbpaste", ["-help"]))
          : false,
      });
    }

    if (this.target === "linux") {
      requirements.push({
        id: "xdg-open",
        description: "xdg-open command is available",
        required: true,
        installed: this.matchesHost() ? await isCommandAvailable("xdg-open", ["--help"]) : false,
      });
    }

    if (this.target === "windows") {
      requirements.push({
        id: "powershell",
        description: "powershell command is available",
        required: true,
        installed: this.matchesHost() ? await isCommandAvailable("powershell", ["-Command", "Get-Host"]) : false,
      });
    }

    return requirements;
  }

  public async validateTargetReady(): Promise<FlowCapabilityError | null> {
    const missing = (await this.listRequirements()).find((item) => item.required && !item.installed);
    if (!missing) {
      return null;
    }

    return createFlowCapabilityError({
      commandIndex: 0,
      command: "target",
      code: "DESKTOP_TARGET_NOT_READY",
      category: "dependency",
      reason: `Desktop target is not ready: ${missing.description}`,
      retryable: false,
      surface: "flow",
      resource: missing.id,
    });
  }

  public async executeCommand(
    command: FlowCommand,
    _appId: string,
    timeoutMs: number,
    correlationId: string,
  ): Promise<CommandExecutionResult> {
    if (command.type === "waitForAnimation") {
      await wait(command.timeoutMs ?? 600);
      return { state: "success", message: "waitForAnimation executed successfully" };
    }

    if (command.type === "launchApp") {
      if (this.target === "osx") {
        const opened = await spawnText("open", ["-a", "Finder"], timeoutMs);
        if (!opened.ok) return asCommandFailure(command.type, opened.error, correlationId, "runtime", true);
        return { state: "success", message: "launchApp executed successfully" };
      }

      if (this.target === "linux") {
        const opened = await spawnText("xdg-open", ["."], timeoutMs);
        if (!opened.ok) return asCommandFailure(command.type, opened.error, correlationId, "runtime", true);
        return { state: "success", message: "launchApp executed successfully" };
      }

      const opened = await spawnText("powershell", ["-Command", "Start-Process notepad"], timeoutMs);
      if (!opened.ok) return asCommandFailure(command.type, opened.error, correlationId, "runtime", true);
      return { state: "success", message: "launchApp executed successfully" };
    }

    if (command.type === "screenshot") {
      const artifactPath = join(await ensureArtifactDirectory(), `${FLOW_ARTIFACT_PREFIX}-${this.target}-${Date.now()}.png`);
      const screenshot = await this.captureScreenshot(artifactPath, timeoutMs);
      if (!screenshot.ok) {
        return asCommandFailure(command.type, screenshot.error, correlationId, "runtime", true);
      }
      const artifact = await buildArtifactMetadata(artifactPath, correlationId, "image/png");
      return {
        state: "success",
        message: `Screenshot saved to ${artifactPath}`,
        artifactPath,
        artifact,
      };
    }

    if (command.type === "clipboardRead") {
      const read = await this.readClipboard(timeoutMs);
      if (!read.ok) {
        return asCommandFailure(command.type, read.error, correlationId, "runtime", true);
      }
      return {
        state: "success",
        message: `clipboardRead executed successfully: ${read.stdout.slice(0, 200)}`,
      };
    }

    if (command.type === "clipboardWrite") {
      const write = await this.writeClipboard(command.value, timeoutMs);
      if (!write.ok) {
        return asCommandFailure(command.type, write.error, correlationId, "runtime", true);
      }
      return { state: "success", message: "clipboardWrite executed successfully" };
    }

    if (command.type === "windowFocus") {
      const focus = await this.focusWindow(command.target, timeoutMs);
      if (!focus.ok) {
        return asCommandFailure(command.type, focus.error, correlationId, "runtime", true);
      }
      return { state: "success", message: "windowFocus executed successfully" };
    }

    return unsupportedForSelector(command.type, `${command.type} is unsupported on ${this.target} adapter`, correlationId);
  }

  private async captureScreenshot(path: string, timeoutMs: number): Promise<{ ok: true } | { ok: false; error: string }> {
    if (this.target === "osx") {
      const result = await spawnText("screencapture", ["-x", path], timeoutMs);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    }

    if (this.target === "linux") {
      const result = await spawnText("sh", ["-lc", `import -window root ${shellQuote(path)}`], timeoutMs);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    }

    // Escape backtick (PS escape char) then single-quote in the file path for a PS single-quoted string.
    const safePath = path.replace(/`/g, "``").replace(/'/g, "''");
    const ps = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $bmp = New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width,[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height); $graphics=[System.Drawing.Graphics]::FromImage($bmp); $graphics.CopyFromScreen(0,0,0,0,$bmp.Size); $bmp.Save('${safePath}');`;
    const result = await spawnText("powershell", ["-Command", ps], timeoutMs);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }

  private async readClipboard(timeoutMs: number): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
    if (this.target === "osx") {
      const read = await spawnText("pbpaste", [], timeoutMs);
      return read.ok ? { ok: true, stdout: read.stdout } : { ok: false, error: read.error };
    }

    if (this.target === "linux") {
      const read = await spawnText("sh", ["-lc", "xclip -selection clipboard -o"], timeoutMs);
      return read.ok ? { ok: true, stdout: read.stdout } : { ok: false, error: read.error };
    }

    const read = await spawnText("powershell", ["-Command", "Get-Clipboard"], timeoutMs);
    return read.ok ? { ok: true, stdout: read.stdout } : { ok: false, error: read.error };
  }

  private async writeClipboard(value: string, timeoutMs: number): Promise<{ ok: true } | { ok: false; error: string }> {
    if (this.target === "osx") {
      const write = await spawnWithInput("pbcopy", [], value, timeoutMs);
      return write.ok ? { ok: true } : { ok: false, error: write.error };
    }

    if (this.target === "linux") {
      const write = await spawnWithInput("xclip", ["-selection", "clipboard"], value, timeoutMs);
      return write.ok ? { ok: true } : { ok: false, error: write.error };
    }

    // In PowerShell single-quoted strings, only `'` needs escaping (as `''`).
    // No other characters have special meaning inside single quotes.
    const escaped = value.replace(/'/g, "''");
    const write = await spawnText("powershell", ["-Command", `Set-Clipboard -Value '${escaped}'`], timeoutMs);
    return write.ok ? { ok: true } : { ok: false, error: write.error };
  }

  private async focusWindow(target: { appId?: string; title?: string }, timeoutMs: number): Promise<{ ok: true } | { ok: false; error: string }> {
    if (this.target === "osx") {
      const appName = target.appId ?? target.title;
      if (!appName) {
        return { ok: false, error: "windowFocus target requires appId or title" };
      }
      // Escape backslashes first, then double-quotes, to prevent AppleScript injection
      // in the `tell application "..."` directive.
      const safeAppName = appName.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
      const script = `tell application "${safeAppName}" to activate`;
      const result = await spawnText("osascript", ["-e", script], timeoutMs);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    }

    if (this.target === "linux") {
      if (!target.title) {
        return { ok: false, error: "windowFocus target requires title on linux" };
      }
      const result = await spawnText("sh", ["-lc", `wmctrl -a ${shellQuote(target.title)}`], timeoutMs);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    }

    if (!target.title) {
      return { ok: false, error: "windowFocus target requires title on windows" };
    }
    // Escape characters special to PowerShell's -like operator (`[`, `]`, `*`, `?`, `` ` ``)
    // and escape single quotes for PowerShell single-quoted string literals (`'` -> `''`).
    const safeTitle = target.title
      .replace(/`/g, "``")
      .replace(/\[/g, "`[")
      .replace(/\]/g, "`]")
      .replace(/\*/g, "`*")
      .replace(/\?/g, "`?")
      .replace(/'/g, "''");
    const script = `$proc = Get-Process | Where-Object {$_.MainWindowTitle -like '*${safeTitle}*'} | Select-Object -First 1; if(-not $proc){ throw 'window not found'; }; $null = $proc.MainWindowHandle`;
    const result = await spawnText("powershell", ["-Command", script], timeoutMs);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }
}

function asCommandFailure(
  commandType: FlowCommand["type"],
  reason: string,
  correlationId: string,
  category: "validation" | "runtime" | "dependency",
  retryable: boolean,
): CommandExecutionResult {
  return {
    state: "error",
    message: `${commandType} failed: ${reason}`,
    error: createFlowCapabilityError({
      commandIndex: 0,
      command: commandType,
      commandType,
      code: `${commandType.toUpperCase()}_FAILED`,
      category,
      reason: `${commandType} failed: ${reason}`,
      retryable,
      correlationId,
      surface: "flow",
    }),
  };
}

function hasTapCoordinates(target: CommandTarget): boolean {
  return Number.isInteger(target.x) && Number.isInteger(target.y);
}

function hasTapSelector(target: CommandTarget): boolean {
  return (
    typeof target.resourceId === "string" && target.resourceId.trim().length > 0 ||
    typeof target.text === "string" && target.text.trim().length > 0 ||
    typeof target.contentDescription === "string" && target.contentDescription.trim().length > 0
  );
}

type TapCoordinateResult = { ok: true; x: number; y: number } | { ok: false; reason: string };

async function resolveTapTargetCoordinates(
  target: CommandTarget,
  timeoutMs: number,
): Promise<TapCoordinateResult> {
  const selector = target.text ?? target.contentDescription ?? target.resourceId;
  if (!selector || selector.length === 0) {
    return { ok: false, reason: "tapOn selector requires text, contentDescription, or resourceId." };
  }

  const dumpPath = "/sdcard/vertu-flow-ui.xml";
  const dump = await spawnText(ANDROID_COMMAND, ["shell", "uiautomator", "dump", dumpPath], timeoutMs);
  if (!dump.ok) {
    return { ok: false, reason: `Failed to dump Android hierarchy: ${dump.error}` };
  }

  const xml = await spawnText(ANDROID_COMMAND, ["shell", "cat", dumpPath], timeoutMs);
  if (!xml.ok) {
    return { ok: false, reason: `Failed to read Android hierarchy dump: ${xml.error}` };
  }

  const point = extractTapCoordinatesFromAndroidDump(xml.stdout, target);
  if (!point) {
    return {
      ok: false,
      reason: `No matching node found for tapOn selector ${JSON.stringify(selector)} in Android hierarchy.`,
    };
  }
  return { ok: true, x: point.x, y: point.y };
}

function extractTapCoordinatesFromAndroidDump(
  dumpXml: string,
  target: CommandTarget,
): { x: number; y: number } | null {
  const nodeRegex = /<node\b[^>]*>/g;
  for (const match of dumpXml.matchAll(nodeRegex)) {
    const nodeMarkup = match[0];
    if (!nodeMarkup) continue;

    const boundsValue = readNodeAttribute(nodeMarkup, "bounds");
    if (!boundsValue) continue;

    const point = parseNodeBounds(boundsValue);
    if (!point) continue;

    const text = readNodeAttribute(nodeMarkup, "text");
    if (target.text !== undefined && target.text.length > 0 && text === target.text) {
      return point;
    }

    const contentDescription = readNodeAttribute(nodeMarkup, "content-desc");
    if (target.contentDescription !== undefined && target.contentDescription.length > 0 && contentDescription === target.contentDescription) {
      return point;
    }

    const resourceId = readNodeAttribute(nodeMarkup, "resource-id");
    if (target.resourceId !== undefined && target.resourceId.length > 0 && resourceId === target.resourceId) {
      return point;
    }
  }

  return null;
}

function readNodeAttribute(nodeMarkup: string, attribute: string): string | undefined {
  const expression = new RegExp(`${attribute}="([^"]*)"`);
  const match = expression.exec(nodeMarkup);
  return match?.[1];
}

function parseNodeBounds(boundsValue: string): { x: number; y: number } | null {
  const match = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(boundsValue);
  if (!match || !match[1] || !match[2] || !match[3] || !match[4]) {
    return null;
  }
  const left = Number.parseInt(match[1], 10);
  const top = Number.parseInt(match[2], 10);
  const right = Number.parseInt(match[3], 10);
  const bottom = Number.parseInt(match[4], 10);
  if ([left, top, right, bottom].some((value) => Number.isNaN(value))) {
    return null;
  }
  return {
    x: Math.floor((left + right) / 2),
    y: Math.floor((top + bottom) / 2),
  };
}

function unsupportedForSelector(commandType: FlowCommand["type"], reason: string, correlationId: string): CommandExecutionResult {
  return {
    state: "unsupported",
    message: reason,
    error: createFlowCapabilityError({
      commandIndex: 0,
      command: commandType,
      commandType,
      code: `${commandType.toUpperCase()}_UNSUPPORTED`,
      category: "unsupported",
      reason,
      retryable: false,
      correlationId,
      surface: "flow",
    }),
  };
}

async function runAndroidAssertion(
  command: Extract<FlowCommand, { type: "assertVisible" | "assertNotVisible" | "assertText" }>,
  timeoutMs: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const dumpPath = "/sdcard/vertu-flow-ui.xml";
  const dump = await spawnText(ANDROID_COMMAND, ["shell", "uiautomator", "dump", dumpPath], timeoutMs);
  if (!dump.ok) {
    return { ok: false, error: dump.error };
  }
  const xml = await spawnText(ANDROID_COMMAND, ["shell", "cat", dumpPath], timeoutMs);
  if (!xml.ok) {
    return { ok: false, error: xml.error };
  }

  const content = xml.stdout;
  const selector = command.target.text ?? command.target.contentDescription ?? command.target.resourceId;
  if (!selector) {
    return { ok: false, error: "assertion requires text/contentDescription/resourceId selector" };
  }

  const matched = content.includes(selector);
  if (command.type === "assertVisible" && !matched) {
    return { ok: false, error: `assertVisible failed: ${selector} not found` };
  }
  if (command.type === "assertNotVisible" && matched) {
    return { ok: false, error: `assertNotVisible failed: ${selector} was found` };
  }
  if (command.type === "assertText") {
    if (!matched || !content.includes(command.value)) {
      return { ok: false, error: `assertText failed: '${command.value}' not found for selector '${selector}'` };
    }
  }

  return { ok: true };
}

async function performAndroidSwipe(
  command: Extract<FlowCommand, { type: "scroll" | "swipe" }>,
  timeoutMs: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const display = await spawnText(ANDROID_COMMAND, ["shell", "wm", "size"], timeoutMs);
  if (!display.ok) {
    return { ok: false, error: display.error };
  }

  const size = parseAndroidDisplay(display.stdout);
  if (!size) {
    return { ok: false, error: "Unable to resolve Android display size" };
  }

  const width = size.width;
  const height = size.height;
  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);
  const fraction = command.type === "swipe" ? command.distanceFraction ?? 0.6 : 0.5;
  const xDelta = Math.floor((width * fraction) / 2);
  const yDelta = Math.floor((height * fraction) / 2);

  let startX = centerX;
  let startY = centerY;
  let endX = centerX;
  let endY = centerY;

  if (command.direction === "UP") {
    startY = centerY + yDelta;
    endY = centerY - yDelta;
  }
  if (command.direction === "DOWN") {
    startY = centerY - yDelta;
    endY = centerY + yDelta;
  }
  if (command.direction === "LEFT") {
    startX = centerX + xDelta;
    endX = centerX - xDelta;
  }
  if (command.direction === "RIGHT") {
    startX = centerX - xDelta;
    endX = centerX + xDelta;
  }

  const swipe = await spawnText(ANDROID_COMMAND, [
    "shell",
    "input",
    "swipe",
    String(startX),
    String(startY),
    String(endX),
    String(endY),
    "200",
  ], timeoutMs);

  return swipe.ok ? { ok: true } : { ok: false, error: swipe.error };
}

async function captureAndroidScreenshot(
  correlationId: string,
  timeoutMs: number,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const proc = Bun.spawn([ANDROID_COMMAND, "exec-out", "screencap", "-p"], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });

  const stdout = proc.stdout ? await new Response(proc.stdout).arrayBuffer() : new ArrayBuffer(0);
  const stderr = proc.stderr ? await new Response(proc.stderr).text() : "";
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    return { ok: false, error: stderr.trim() || `adb screencap failed with exit code ${exitCode}` };
  }

  if (stdout.byteLength === 0) {
    return { ok: false, error: "adb screencap returned empty output" };
  }

  const artifactPath = join(await ensureArtifactDirectory(), `${FLOW_ARTIFACT_PREFIX}-android-${Date.now()}-${correlationId}.png`);
  await Bun.write(artifactPath, new Uint8Array(stdout));
  return { ok: true, path: artifactPath };
}

function parseAndroidDisplay(output: string): { width: number; height: number } | null {
  const match = /(?:Physical size|Override size):\s*(\d+)x(\d+)/.exec(output);
  if (!match?.[1] || !match?.[2]) {
    return null;
  }

  const width = Number.parseInt(match[1], 10);
  const height = Number.parseInt(match[2], 10);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  return { width, height };
}

async function spawnText(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ ok: true; stdout: string; stderr: string } | { ok: false; error: string }> {
  const resolvedCommand = Bun.which(command);
  if (!resolvedCommand) {
    return { ok: false, error: `${command} is not installed or not on PATH` };
  }

  return Promise.resolve()
    .then(() => Bun.spawn([resolvedCommand, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    }))
    .then(async (proc) => {
      const stdoutPromise = proc.stdout ? new Response(proc.stdout).text() : Promise.resolve("");
      const stderrPromise = proc.stderr ? new Response(proc.stderr).text() : Promise.resolve("");
      const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        return { ok: false as const, error: stderr.trim() || `exit code ${exitCode}` };
      }
      return { ok: true as const, stdout, stderr };
    }, (failure: FailureValue) => ({ ok: false as const, error: normalizeFailureMessage(failure) }));
}

async function spawnWithInput(
  command: string,
  args: string[],
  input: string,
  timeoutMs: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const resolvedCommand = Bun.which(command);
  if (!resolvedCommand) {
    return { ok: false, error: `${command} is not installed or not on PATH` };
  }

  return Promise.resolve()
    .then(() => Bun.spawn([resolvedCommand, ...args], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    }))
    .then(async (proc) => {
      if (proc.stdin) {
        void proc.stdin.write(input);
        void proc.stdin.flush();
        void proc.stdin.end();
      }

      const stderr = proc.stderr ? await new Response(proc.stderr).text() : "";
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        return { ok: false as const, error: stderr.trim() || `exit code ${exitCode}` };
      }

      return { ok: true as const };
    }, (failure: FailureValue) => ({ ok: false as const, error: normalizeFailureMessage(failure) }));
}

async function isCommandAvailable(command: string, args: string[]): Promise<boolean> {
  const result = await spawnText(command, args, DEFAULT_ADAPTER_COMMAND_TIMEOUT_MS);
  return result.ok;
}

async function listAdbDevices(): Promise<string[]> {
  const result = await spawnText(ANDROID_COMMAND, ["devices"], DEFAULT_ADAPTER_COMMAND_TIMEOUT_MS);
  if (!result.ok) {
    return [];
  }

  return result.stdout
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(/\s+/))
    .filter((line) => line.length >= 2 && line[1] === "device")
    .map((line) => line[0] ?? "")
    .filter((line) => line.length > 0);
}

async function hasBootedIosSimulator(): Promise<boolean> {
  const list = await spawnText(IOS_COMMAND, ["simctl", "list", "devices", "booted"], DEFAULT_ADAPTER_COMMAND_TIMEOUT_MS);
  if (!list.ok) {
    return false;
  }

  return list.stdout.includes("Booted");
}

async function ensureArtifactDirectory(): Promise<string> {
  const candidate = process.env.VERTU_FLOW_ARTIFACT_DIR?.trim();
  if (candidate && candidate.length > 0) {
    await mkdir(candidate, { recursive: true });
    return candidate;
  }

  const fallback = join(import.meta.dir, "..", ".artifacts", "flows");
  await mkdir(fallback, { recursive: true });
  return dirname(join(fallback, "placeholder"));
}

async function buildArtifactMetadata(path: string, correlationId: string, contentType: string): Promise<ArtifactMetadata> {
  const file = Bun.file(path);
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return {
    artifactPath: path,
    sha256,
    sizeBytes: bytes.byteLength,
    createdAt: new Date().toISOString(),
    contentType,
    correlationId,
  };
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, delayMs)));
}

type FailureValue =
  | Error
  | string
  | number
  | boolean
  | { message?: string }
  | null
  | undefined;

function normalizeFailureMessage(error: FailureValue): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "number" || typeof error === "boolean") return String(error);
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Command execution failed";
}

function createCorrelationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `flow-${Date.now()}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
