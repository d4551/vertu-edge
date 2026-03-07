import { expect, test } from "bun:test";
import {
  buildJobRouteFromKind,
  isSupportedBuildKind,
  normalizeModelRef,
  validateModelRef,
  validateModelRefWithPolicy,
  validateModelRefWithSource,
  isFlowCommandType,
  SUPPORTED_FLOW_COMMANDS,
} from "../../contracts/flow-contracts";

test("validateModelRef accepts huggingface owner/repo inputs", () => {
  expect(validateModelRef("zai-org/AutoGLM-Phone-9B-Multilingual").ok).toBe(true);
  expect(
    validateModelRefWithSource(
      "huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual",
      "huggingface",
      { mode: "huggingface", canonicalHost: "huggingface.co" },
    ).normalized,
  ).toBe("huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual");
  expect(
    normalizeModelRef(
      "https://huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual",
      "huggingface",
      { mode: "huggingface", canonicalHost: "huggingface.co" },
    ),
  ).toBe("huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual");
  expect(
    normalizeModelRef(
      "huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual",
      "huggingface",
      { mode: "huggingface", canonicalHost: "huggingface.co" },
    ),
  ).toBe("huggingface.co/zai-org/AutoGLM-Phone-9B-Multilingual");
});

test("validateModelRef rejects malformed references", () => {
  expect(validateModelRef("invalid input").ok).toBe(false);
  expect(
    validateModelRefWithSource("owner/", "huggingface", {
      mode: "huggingface",
      canonicalHost: "huggingface.co",
    }).ok,
  ).toBe(false);
  expect(
    validateModelRefWithPolicy("https://example.com/foo/bar", {
      mode: "huggingface",
      canonicalHost: "huggingface.co",
    }).ok,
  ).toBe(false);
});

test("validateModelRefWithSource accepts non-huggingface providers", () => {
  expect(validateModelRefWithSource("meta-llama/Llama-3.1-70B", "openrouter")).toEqual({
    ok: true,
    normalized: "meta-llama/Llama-3.1-70B",
  });
  expect(validateModelRefWithSource("meta/llama-3.1", "openrouter")).toEqual({
    ok: true,
    normalized: "meta/llama-3.1",
  });
});

test("validateModelRefWithPolicy supports host-normalized sources", () => {
  expect(validateModelRefWithPolicy("https://huggingface.co/google/gemma-2", {
    mode: "huggingface",
    canonicalHost: "huggingface.co",
  })).toEqual({
    ok: true,
    normalized: "huggingface.co/google/gemma-2",
  });
});

test("validateModelRefWithSource rejects unsafe values for non-huggingface sources", () => {
  expect(validateModelRefWithSource("meta llama", "openrouter").ok).toBe(false);
  expect(validateModelRefWithSource("meta\\llama", "openrouter").ok).toBe(false);
});

test("Build platform helpers are strict", () => {
  expect(isSupportedBuildKind("android")).toBe(true);
  expect(isSupportedBuildKind("ios")).toBe(true);
  expect(isSupportedBuildKind("desktop")).toBe(true);
  expect(isSupportedBuildKind("web")).toBe(false);
  expect(buildJobRouteFromKind("android")).toBe("/api/apps/build");
  expect(buildJobRouteFromKind("android", "job-1")).toBe("/api/apps/build/job-1");
  expect(buildJobRouteFromKind("desktop")).toBe("/api/apps/build");
  expect(buildJobRouteFromKind("desktop", "job-2")).toBe("/api/apps/build/job-2");
});

test("Supported flow command registry matches parser command detection", () => {
  for (const command of SUPPORTED_FLOW_COMMANDS) {
    expect(isFlowCommandType(command.type)).toBe(true);
  }
});
