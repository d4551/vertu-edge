/**
 * Server-side i18n for control-plane strings.
 *
 * Single source of truth: locale JSON files under src/locales/.
 * Each file is loaded once at startup via synchronous fs read.
 * Adding a new locale only requires creating src/locales/<code>.json
 * and adding the code to SUPPORTED_LOCALES below.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "./logger";

/** Supported locale codes. Extend this tuple when adding a new language. */
export const SUPPORTED_LOCALES = ["en", "es", "fr", "zh"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Default locale used when no override is provided. */
export const DEFAULT_LOCALE: Locale = "en";
let activeLocale: Locale = DEFAULT_LOCALE;

const LOCALES_DIR = join(import.meta.dir, "locales");

function loadLocaleSync(code: string): Record<string, string> {
  const filePath = join(LOCALES_DIR, `${code}.json`);
  if (!existsSync(filePath)) {
    logger.warn("locale file not found", { filePath });
    return {};
  }

  const raw = readFileSync(filePath, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    logger.warn("locale file has invalid shape", { filePath });
    return {};
  }
  return parsed as Record<string, string>;
}

/** Pre-loaded locale dictionaries keyed by locale code. */
const LOCALE_MAP = new Map<Locale, Record<string, string>>();
for (const code of SUPPORTED_LOCALES) {
  LOCALE_MAP.set(code, loadLocaleSync(code));
}

/** Runtime locale guard. */
export function isSupportedLocale(value: string | null | undefined): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Resolve arbitrary locale value to a known locale (or default). */
export function resolveLocale(value: string | null | undefined): Locale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

/** Set active locale used for translation calls that omit explicit locale. */
export function setActiveLocale(locale: Locale): void {
  activeLocale = locale;
}

/** Get active locale currently used by server-rendered templates. */
export function getActiveLocale(): Locale {
  return activeLocale;
}

/** Look up a translation string. Falls back to English, then the raw key. */
export function t(key: string, locale: Locale = activeLocale): string {
  const primary = LOCALE_MAP.get(locale);
  if (primary) {
    const value = primary[key];
    if (value !== undefined) return value;
  }
  // Fallback to English if the requested locale is missing the key.
  if (locale !== "en") {
    const en = LOCALE_MAP.get("en");
    if (en) {
      const value = en[key];
      if (value !== undefined) return value;
    }
  }
  return key;
}

/** Interpolate {placeholder} tokens in a translated string. */
export function tInterp(key: string, values: Record<string, string>, locale: Locale = activeLocale): string {
  let s = t(key, locale);
  for (const [k, v] of Object.entries(values)) {
    s = s.replace(new RegExp(`\\{${k}\\}`, "g"), v);
  }
  return s;
}
