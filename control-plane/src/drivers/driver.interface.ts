import type {
  FlowCapabilityError,
  FlowCapabilityRequirement,
  FlowCommand,
  FlowCommandResult,
  FlowRunTarget,
} from "../../../contracts/flow-contracts";

/** Result shape for a single command execution (no index/type/attempts metadata). */
export type CommandExecutionResult = Omit<FlowCommandResult, "commandIndex" | "commandType" | "attempts">;

/**
 * Platform-specific adapter for RPA command execution.
 *
 * Each target platform (Android, iOS, Desktop) implements this interface.
 * Adapters are registered via the DriverRegistry and resolved dynamically.
 */
export interface RpaTargetAdapter {
  /** The target platform this adapter handles. */
  readonly target: FlowRunTarget;

  /** List external requirements (e.g. ADB, xcrun, device connected). */
  listRequirements(): Promise<FlowCapabilityRequirement[]>;

  /** Validate that the target is reachable and ready for commands. */
  validateTargetReady(): Promise<FlowCapabilityError | null>;

  /** Check whether a specific command type is supported. */
  supportsCommand(commandType: FlowCommand["type"]): boolean;

  /** Execute a single flow command and return the result. */
  executeCommand(
    command: FlowCommand,
    appId: string,
    timeoutMs: number,
    correlationId: string,
  ): Promise<CommandExecutionResult>;
}
