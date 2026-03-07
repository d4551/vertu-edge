import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SUPPORTED_LOCALES } from "../src/i18n";

const PROJECT_ROOT = join(import.meta.dir, "..");
const LOCALES_DIR = join(PROJECT_ROOT, "src", "locales");
const SOURCE_DIR = join(PROJECT_ROOT, "src");

function readLocale(code: string): Record<string, string> {
  const raw = readFileSync(join(LOCALES_DIR, `${code}.json`), "utf8");
  return JSON.parse(raw) as Record<string, string>;
}

function listTypeScriptFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const output: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      output.push(...listTypeScriptFiles(full));
      continue;
    }
    if (entry.isFile() && full.endsWith(".ts")) {
      output.push(full);
    }
  }
  return output;
}

function collectUsedTranslationKeys(): Set<string> {
  const files = listTypeScriptFiles(SOURCE_DIR);
  const keys = new Set<string>();
  const patterns = [/\bt\(\s*"([^"]+)"/g, /\btInterp\(\s*"([^"]+)"/g, /\btStr\(\s*"([^"]+)"/g];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source)) !== null) {
        const key = match[1]?.trim();
        if (key) {
          keys.add(key);
        }
      }
    }
  }
  return keys;
}

test("all locales contain the same key set as English", () => {
  const en = readLocale("en");
  const enKeys = Object.keys(en).sort();
  for (const locale of SUPPORTED_LOCALES) {
    const localeData = readLocale(locale);
    const localeKeys = Object.keys(localeData).sort();
    expect(localeKeys).toEqual(enKeys);
  }
});

test("all statically referenced translation keys exist in every locale", () => {
  const usedKeys = collectUsedTranslationKeys();
  for (const locale of SUPPORTED_LOCALES) {
    const localeData = readLocale(locale);
    const missing = Array.from(usedKeys).filter((key) => localeData[key] === undefined);
    expect(missing).toEqual([]);
  }
});

test("Chinese locale has no broken concatenation artifacts", () => {
  const zh = readLocale("zh");
  const values = Object.values(zh);
  for (const value of values) {
    expect(value).not.toContain("BAD");
  }
});

test("intentionally empty locale values are consistent across all locales", () => {
  const en = readLocale("en");
  const emptyInEn = new Set(Object.entries(en).filter(([, v]) => v === "").map(([k]) => k));
  for (const locale of SUPPORTED_LOCALES) {
    const localeData = readLocale(locale);
    const emptyInLocale = new Set(Object.entries(localeData).filter(([, v]) => v === "").map(([k]) => k));
    expect(emptyInLocale).toEqual(emptyInEn);
  }
});
