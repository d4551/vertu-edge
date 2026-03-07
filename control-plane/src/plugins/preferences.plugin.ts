import { Elysia } from "elysia";
import { DEFAULT_LOCALE, type Locale } from "../i18n";
import { DEFAULT_CHAT_MODEL, DEFAULT_THEME } from "../config";
import { esc, renderPreferenceStateEnvelope } from "../renderers";
import { type PreferenceRunEnvelope } from "../../../contracts/flow-contracts";
import { t as tStr, tInterp } from "../i18n";
import { preferenceBodySchema } from "../contracts/http";

const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
const PREFERENCES_ROUTE = "/api/prefs";

type PreferencesPluginDependencies = {
  /** Read persisted control-plane preference values. */
  readonly getPreference: (key: string) => string | null;
  /** Persist control-plane preference values. */
  readonly setPreference: (key: string, value: string) => void;
  /** Validate supported themes. */
  readonly isSupportedTheme: (value: string) => boolean;
  /** Validate supported locales. */
  readonly isSupportedLocale: (value: string) => value is Locale;
  /** Validate model identifiers. */
  readonly isValidModelIdentifier: (value: string) => boolean;
  /** Apply active locale to runtime rendering. */
  readonly setActiveLocale: (locale: Locale) => void;
};

/** Create the `/api/prefs` plugin for theme/model/locale preferences. */
export function createPreferencesPlugin({
  getPreference,
  setPreference,
  isSupportedTheme,
  isSupportedLocale,
  isValidModelIdentifier,
  setActiveLocale,
}: PreferencesPluginDependencies) {
  return new Elysia({ name: "preferences", prefix: PREFERENCES_ROUTE })
    .get("/theme/:theme", ({ params, set }) => {
      const theme = params.theme?.toLowerCase();
      if (theme && isSupportedTheme(theme)) {
        setPreference("theme", theme);
      }
      set.redirect = "/";
    })
    .get("/locale/:locale", ({ params, set }) => {
      const locale = params.locale?.toLowerCase();
      if (locale && isSupportedLocale(locale)) {
        setPreference("locale", locale);
        setActiveLocale(locale);
      }
      set.redirect = "/";
    })
    .post("/", ({ body, set }) => {
      set.headers["content-type"] = HTML_CONTENT_TYPE;

      const requestedTheme = typeof body?.theme === "string" ? body.theme.trim() : "";
      const requestedModel = typeof body?.defaultModel === "string" ? body.defaultModel.trim() : "";
      const requestedLocale = typeof body?.locale === "string" ? body.locale.trim().toLowerCase() : "";
      const mismatches: string[] = [];

      const currentTheme = getPreference("theme") ?? DEFAULT_THEME;
      const currentModel = getPreference("defaultModel") ?? DEFAULT_CHAT_MODEL;
      const currentLocalePreference = getPreference("locale");
      const currentLocale: Locale = currentLocalePreference && isSupportedLocale(currentLocalePreference)
        ? currentLocalePreference
        : DEFAULT_LOCALE;
      const hasInput = requestedTheme.length > 0 || requestedModel.length > 0 || requestedLocale.length > 0;

      if (!hasInput) {
        const envelope: PreferenceRunEnvelope = {
          route: PREFERENCES_ROUTE,
          state: "empty",
          data: {
            requestedTheme: null,
            effectiveTheme: currentTheme,
            requestedModel: null,
            effectiveModel: currentModel,
            requestedLocale: null,
            effectiveLocale: currentLocale,
          },
          mismatches: [],
        };
        return renderPreferenceStateEnvelope(PREFERENCES_ROUTE, envelope);
      }

      if (requestedTheme) {
        if (!isSupportedTheme(requestedTheme)) {
          mismatches.push(tInterp("api.prefs_theme_invalid", { theme: requestedTheme }));
        } else if (requestedTheme !== currentTheme) {
          setPreference("theme", requestedTheme);
        }
      }

      if (requestedModel) {
        if (!isValidModelIdentifier(requestedModel)) {
          mismatches.push(tInterp("api.prefs_model_invalid", { model: requestedModel }));
        } else if (requestedModel !== currentModel) {
          setPreference("defaultModel", requestedModel);
        }
      }

      if (requestedLocale) {
        if (!isSupportedLocale(requestedLocale)) {
          mismatches.push(tInterp("api.prefs_locale_invalid", { locale: requestedLocale }));
        } else if (requestedLocale !== currentLocale) {
          setPreference("locale", requestedLocale);
          setActiveLocale(requestedLocale);
        }
      }

      const effectiveTheme = getPreference("theme") ?? DEFAULT_THEME;
      const effectiveModel = getPreference("defaultModel") ?? DEFAULT_CHAT_MODEL;
      const effectiveLocalePreference = getPreference("locale");
      const effectiveLocale: Locale = effectiveLocalePreference && isSupportedLocale(effectiveLocalePreference)
        ? effectiveLocalePreference
        : DEFAULT_LOCALE;

      const envelope: PreferenceRunEnvelope = {
        route: PREFERENCES_ROUTE,
        state: mismatches.length > 0 ? "error-retryable" : "success",
        data: {
          requestedTheme: requestedTheme.length > 0 ? requestedTheme : null,
          effectiveTheme,
          requestedModel: requestedModel.length > 0 ? requestedModel : null,
          effectiveModel,
          requestedLocale: requestedLocale.length > 0 ? requestedLocale : null,
          effectiveLocale,
        },
        mismatches,
      };

      const mainHtml = envelope.state === "success"
        ? ""
        : renderPreferenceStateEnvelope(PREFERENCES_ROUTE, envelope);
      const toastHtml = envelope.state === "success"
        ? `<div id="toast-container" hx-swap-oob="innerHTML"><div class="alert alert-success" role="status"><span>${esc(tStr("api.prefs_saved"))}</span></div></div>`
        : "";
      return mainHtml + toastHtml;
    }, {
      body: preferenceBodySchema,
    });
}
