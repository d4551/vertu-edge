import { describe, expect, test } from "bun:test";
import {
  APP_BUILD_FAILURE_CODE_KEY,
  APP_BUILD_FAILURE_MESSAGE_KEY,
  formatAppBuildFailureMetadata,
  parseAppBuildFailureMetadata,
} from "../../../shared/app-build-failures";

describe("app build failure metadata", () => {
  test("formats deterministic key-value output", () => {
    const serialized = formatAppBuildFailureMetadata({
      code: "ios_platform_support_missing",
      message: "Missing iOS simulator platform support.",
    });

    expect(serialized).toContain(`${APP_BUILD_FAILURE_CODE_KEY}=ios_platform_support_missing`);
    expect(serialized).toContain(`${APP_BUILD_FAILURE_MESSAGE_KEY}=Missing iOS simulator platform support.`);
  });

  test("parses deterministic key-value output", () => {
    const parsed = parseAppBuildFailureMetadata([
      `${APP_BUILD_FAILURE_CODE_KEY}=ios_required_destination_missing`,
      `${APP_BUILD_FAILURE_MESSAGE_KEY}=No eligible iOS simulator destination is available.`,
    ].join("\n"));

    expect(parsed).toEqual({
      code: "ios_required_destination_missing",
      message: "No eligible iOS simulator destination is available.",
    });
  });

  test("ignores malformed metadata payloads", () => {
    expect(parseAppBuildFailureMetadata("APP_BUILD_FAILURE_CODE=unknown_code")).toBeNull();
    expect(parseAppBuildFailureMetadata(`${APP_BUILD_FAILURE_MESSAGE_KEY}=Only message`)).toBeNull();
  });
});
