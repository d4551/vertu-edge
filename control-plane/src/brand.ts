/**
 * Vertu brand palette — derived from shared/brand-tokens.json (single source of truth).
 * Consumed by: brand-overrides.css, Android Color.kt, iOS VertuTheme.swift.
 */
import brandTokens from "../../shared/brand-tokens.json";

/** Canonical brand color palette (hex with #). */
export const BRAND = brandTokens.colors;

/** Semantic status colors (light/dark mode pairs). */
export const BRAND_SEMANTIC = brandTokens.semantic;

/** Canonical shape radii in px — match Android/iOS component tokens. */
export const BRAND_SHAPE = brandTokens.shape;

/** Canonical spacing values in px — match Android/iOS component tokens. */
export const BRAND_SPACING = brandTokens.spacing;

/** Hex without # for URL encoding (e.g. data URIs). */
export const BRAND_HEX = {
  gold: BRAND.gold.slice(1),
  goldDeep: BRAND.goldDeep.slice(1),
  goldLight: BRAND.goldLight.slice(1),
  charcoal: BRAND.charcoal.slice(1),
  black: BRAND.black.slice(1),
  cream: BRAND.cream.slice(1),
  ivory: BRAND.ivory.slice(1),
} as const;

/** Favicon SVG (gold cube on charcoal) — uses BRAND_HEX for consistency */
export function faviconSvg(): string {
  const bg = BRAND_HEX.charcoal;
  const stroke = BRAND_HEX.gold;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#${bg}"/><path d="M16 6l8 4v8l-8 4-8-4V10z" fill="none" stroke="#${stroke}" stroke-width="1.5"/><path d="M16 6v16M8 10l8 4 8-4" fill="none" stroke="#${stroke}" stroke-width="1.2"/></svg>`;
}

/** Favicon as data URI for inline use (layout <link rel="icon">) */
export function faviconDataUri(): string {
  const svg = faviconSvg();
  const encoded = encodeURIComponent(svg).replace(/'/g, "%27");
  return `data:image/svg+xml,${encoded}`;
}

/** Navbar logo SVG (use with text-primary for theme-aware stroke). Path matches favicon. */
export const LOGO_SVG_PATH =
  '<path d="M12 4l6 3v6l-6 3-6-3V7z" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 4v12M6 7l6 3 6-3" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>';
