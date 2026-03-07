package com.google.ai.edge.gallery.common

import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat

/** Sentinel tag that defers locale resolution back to the system language. */
internal const val APP_LOCALE_SYSTEM = "system"

/** Supported operator locales shared by Android settings and startup bootstrap. */
internal val SUPPORTED_APP_LOCALE_TAGS: Set<String> =
  setOf(APP_LOCALE_SYSTEM, "en", "es", "fr", "zh-CN")

/** Normalize arbitrary locale input to a supported persisted tag. */
internal fun normalizeAppLocaleTag(rawTag: String?): String {
  val normalized = rawTag?.trim().orEmpty()
  if (normalized.isEmpty()) {
    return APP_LOCALE_SYSTEM
  }
  return when {
    SUPPORTED_APP_LOCALE_TAGS.contains(normalized) -> normalized
    normalized.equals("zh", ignoreCase = true) -> "zh-CN"
    normalized.equals("zh-Hans", ignoreCase = true) -> "zh-CN"
    else -> APP_LOCALE_SYSTEM
  }
}

/** Apply the persisted locale contract to the process-wide app configuration. */
internal fun applyAppLocale(appLocaleTag: String) {
  val normalized = normalizeAppLocaleTag(appLocaleTag)
  val localeList =
    if (normalized == APP_LOCALE_SYSTEM) {
      LocaleListCompat.getEmptyLocaleList()
    } else {
      LocaleListCompat.forLanguageTags(normalized)
    }
  AppCompatDelegate.setApplicationLocales(localeList)
}
