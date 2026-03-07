import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConfigParseError } from "../src/errors";
import { DEVICE_AI_PROFILE_CONFIG_PATH, readDeviceAiProfileFile } from "../src/config/device-ai-profile";

function withTempRoot<T>(prefix: string, run: (tempRoot: string) => Promise<T>): Promise<T> {
  return mkdtemp(join(tmpdir(), prefix))
    .then((tempRoot) =>
      Promise.resolve(run(tempRoot))
        .finally(async () => rm(tempRoot, { recursive: true, force: true })));
}

test("readDeviceAiProfileFile loads the canonical device AI profile", async () => {
  const profile = await readDeviceAiProfileFile(DEVICE_AI_PROFILE_CONFIG_PATH);

  expect(profile.requiredModelRef.length).toBeGreaterThan(0);
  expect(profile.requiredModelFile.length).toBeGreaterThan(0);
  expect(profile.requiredModelSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(profile.requiredCapabilities.length).toBeGreaterThan(0);
});

test("readDeviceAiProfileFile fails closed when the canonical profile file is missing", async () => {
  await withTempRoot("vertu-device-ai-profile-", async (tempRoot) => {
    const missingPath = join(tempRoot, "missing-device-ai-profile.json");
    await expect(readDeviceAiProfileFile(missingPath)).rejects.toBeInstanceOf(ConfigParseError);
  });
});

test("readDeviceAiProfileFile rejects invalid device AI profile payloads", async () => {
  await withTempRoot("vertu-device-ai-profile-invalid-", async (tempRoot) => {
    const invalidPath = join(tempRoot, "device-ai-profile.json");
    await writeFile(invalidPath, JSON.stringify({ profileVersion: "1.0" }));
    await expect(readDeviceAiProfileFile(invalidPath)).rejects.toBeInstanceOf(ConfigParseError);
  });
});
