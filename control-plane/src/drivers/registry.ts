import type { FlowRunTarget } from "../../../contracts/flow-contracts";
import type { RpaTargetAdapter } from "./driver.interface";

/** Factory function that creates a new adapter instance for a target. */
export type DriverFactory = () => RpaTargetAdapter;

/**
 * Dynamic driver registry for RPA target adapters.
 *
 * Replaces the hardcoded `createAdapter()` if/else chain with a pluggable
 * registration system. Built-in drivers (Android, iOS, Desktop) are registered
 * at startup via `registerBuiltinDrivers()`. Custom drivers can be added
 * at runtime for extension scenarios.
 */
class DriverRegistry {
  private readonly factories = new Map<FlowRunTarget, DriverFactory>();

  /** Register a driver factory for a target platform. */
  register(target: FlowRunTarget, factory: DriverFactory): void {
    this.factories.set(target, factory);
  }

  /** Create a new adapter instance for the given target. */
  create(target: FlowRunTarget): RpaTargetAdapter {
    const factory = this.factories.get(target);
    if (!factory) {
      const available = this.listTargets().join(", ");
      throw new Error(`No driver registered for target "${target}". Available: ${available}`);
    }
    return factory();
  }

  /** List all registered target platforms. */
  listTargets(): FlowRunTarget[] {
    return [...this.factories.keys()];
  }

  /** Check whether a driver is registered for the given target. */
  hasTarget(target: FlowRunTarget): boolean {
    return this.factories.has(target);
  }

  /** Return the number of registered drivers. */
  get size(): number {
    return this.factories.size;
  }
}

/** Singleton driver registry shared across the control-plane. */
export const driverRegistry = new DriverRegistry();
