import { Elysia } from "elysia";
import type { DeviceAiReadinessEnvelope } from "../../../contracts/flow-contracts";
import { DEVICE_AI_READINESS_ROUTE } from "../runtime-constants";

interface DeviceReadinessPluginServices {
  /** Resolve the current host/device readiness envelope for dashboard rendering. */
  readonly resolveDeviceAiReadinessEnvelope: () => DeviceAiReadinessEnvelope;
}

interface CreateDeviceReadinessPluginOptions {
  /** Runtime services injected by the app factory. */
  readonly services: DeviceReadinessPluginServices;
  /** Render readiness state as server-driven HTML. */
  readonly renderDeviceAiReadinessState: (route: string, envelope: DeviceAiReadinessEnvelope) => string;
}

/** Create the HTMX device-readiness plugin for the build dashboard surface. */
export function createDeviceReadinessPlugin(options: CreateDeviceReadinessPluginOptions) {
  return new Elysia({ name: "device-readiness", prefix: "/api/device-ai" })
    .get("/readiness", () => {
      const envelope = options.services.resolveDeviceAiReadinessEnvelope();
      return options.renderDeviceAiReadinessState(DEVICE_AI_READINESS_ROUTE, envelope);
    });
}
