import { describe, expect, test } from "bun:test";
import {
  compileFlowFile,
  doctor,
  validateDeviceAiProfileFile,
  validateDeviceAiReportFile,
  validateFlowFile,
  validateModelManifestFile,
} from "../src/commands";
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const FIXTURES_DIR = resolve(import.meta.dir, "..", "..", "..", "contracts", "fixtures");
const FLOW_KIT_DIR = resolve(import.meta.dir, "..");

describe("happy-path validation", () => {
  test("validate and compile flow fixture", () => {
    const flowPath = resolve(FIXTURES_DIR, "contact-flow.yaml");
    validateFlowFile(flowPath);

    const outputPath = compileFlowFile(flowPath);
    const compiled = JSON.parse(readFileSync(resolve(outputPath), "utf-8")) as {
      appId: string;
      steps: Array<string | Record<string, string>>;
    };
    expect(compiled.appId).toBe("com.vertu.edge");
    expect(compiled.steps.length).toBeGreaterThan(0);
  });

  test("validate model manifest fixture", () => {
    const manifestPath = resolve(import.meta.dir, "..", "..", "..", "model_allowlist.json");
    validateModelManifestFile(manifestPath);
  });

  test("validate device-ai profile fixture", () => {
    const profilePath = resolve(import.meta.dir, "..", "..", "..", "control-plane", "config", "device-ai-profile.json");
    validateDeviceAiProfileFile(profilePath);
  });

  test("validate device-ai report fixture", () => {
    const reportPath = resolve(import.meta.dir, "..", "..", "..", "contracts", "fixtures", "device-ai-report.json");
    validateDeviceAiReportFile(reportPath);
  });

  test("doctor reports device AI readiness rows", async () => {
    const proc = Bun.spawn([process.execPath, "src/cli.ts", "doctor"], {
      cwd: FLOW_KIT_DIR,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");
    expect(stdout).toContain("device_ai_protocol");
    expect(stdout).toContain("hf_token");
    expect(stdout).toContain("ios_macos_host");
    expect(stdout).toContain("ios_xcrun");
    expect(stdout).toContain("ios_simctl");
  });
});

describe("error-path validation", () => {
  test("validateFlowFile throws on nonexistent file", () => {
    expect(() => validateFlowFile("/tmp/nonexistent-flow-file-12345.yaml")).toThrow();
  });

  test("compileFlowFile throws on nonexistent file", () => {
    expect(() => compileFlowFile("/tmp/nonexistent-flow-file-12345.yaml")).toThrow();
  });

  test("validateModelManifestFile throws on nonexistent file", () => {
    expect(() => validateModelManifestFile("/tmp/nonexistent-manifest-12345.json")).toThrow();
  });

  test("validateFlowFile throws on invalid YAML content", () => {
    const tmpPath = "/tmp/vertu-test-invalid-flow.yaml";
    writeFileSync(tmpPath, "not: valid: flow: yaml: [[[");
    try {
      expect(() => validateFlowFile(tmpPath)).toThrow();
    } finally {
      unlinkSync(tmpPath);
    }
  });

  test("validateModelManifestFile throws on malformed JSON", () => {
    const tmpPath = "/tmp/vertu-test-invalid-manifest.json";
    writeFileSync(tmpPath, "{ not valid json");
    try {
      expect(() => validateModelManifestFile(tmpPath)).toThrow();
    } finally {
      unlinkSync(tmpPath);
    }
  });

  test("validateDeviceAiReportFile throws on malformed JSON", () => {
    const tmpPath = "/tmp/vertu-test-invalid-device-ai-report.json";
    writeFileSync(tmpPath, "{ broken report");
    try {
      expect(() => validateDeviceAiReportFile(tmpPath)).toThrow();
    } finally {
      unlinkSync(tmpPath);
    }
  });

  test("validateFlowFile throws on empty file", () => {
    const tmpPath = "/tmp/vertu-test-empty-flow.yaml";
    writeFileSync(tmpPath, "");
    try {
      expect(() => validateFlowFile(tmpPath)).toThrow();
    } finally {
      unlinkSync(tmpPath);
    }
  });

  test("doctor rejects plaintext provider credentials in the audited database", async () => {
    const dbPath = `/tmp/vertu-provider-integrity-${crypto.randomUUID()}.sqlite`;
    const database = new Database(dbPath, { create: true, strict: true });
    database.run(`
      CREATE TABLE IF NOT EXISTS api_keys (
        provider TEXT PRIMARY KEY,
        api_key TEXT NOT NULL,
        base_url TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    database
      .prepare("INSERT INTO api_keys (provider, api_key, updated_at) VALUES (?, ?, ?)")
      .run("openai", "plaintext-provider-key", "2026-03-07T00:00:00.000Z");
    database.close(false);

    try {
      await expect(doctor(dbPath)).rejects.toThrow(/Provider credential integrity audit failed/);
    } finally {
      if (existsSync(dbPath)) {
        unlinkSync(dbPath);
      }
    }
  });
});
