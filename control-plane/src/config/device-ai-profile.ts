/** Canonical device-AI profile loading for control-plane runtime config. */

import { join } from "node:path";
import { parseDeviceAiProtocolProfile, type DeviceAiProtocolProfile } from "../../../contracts/device-ai-protocol";
import { ConfigParseError } from "../errors";
import { safeParseJson, type JsonValue } from "./env";

/** Canonical repository path for the pinned device-AI profile JSON. */
export const DEVICE_AI_PROFILE_CONFIG_PATH = join(import.meta.dir, "..", "..", "config", "device-ai-profile.json");

/**
 * Read and validate the pinned device-AI profile from disk.
 *
 * The control-plane fails closed when this file is missing or invalid because
 * Android, iOS, and flow-kit now share this file as the single source of truth
 * for the required model contract.
 */
export async function readDeviceAiProfileFile(path: string): Promise<DeviceAiProtocolProfile> {
  const file = Bun.file(path);
  const exists = await file.exists();
  if (!exists) {
    throw new ConfigParseError(
      `Device AI profile file is missing at '${path}'`,
      { details: "Missing canonical device-ai profile config file." },
    );
  }

  const raw = await file.text();
  const parsed = safeParseJson<JsonValue>(raw);
  if (!parsed.ok) {
    throw new ConfigParseError(`Failed to parse device AI profile JSON from '${path}': ${parsed.error}`, {
      details: parsed.error,
    });
  }

  const profile = parseDeviceAiProtocolProfile(parsed.data);
  if (!profile) {
    throw new ConfigParseError(`Failed to validate device AI profile JSON from '${path}'`, {
      details: "Invalid device-ai profile payload",
    });
  }
  return profile;
}
