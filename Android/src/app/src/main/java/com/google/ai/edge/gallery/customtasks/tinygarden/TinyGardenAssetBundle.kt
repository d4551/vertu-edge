/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.google.ai.edge.gallery.customtasks.tinygarden

import android.content.Context
import com.google.ai.edge.gallery.common.VertuRuntimeConfig
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

private const val TINY_GARDEN_ASSET_MANIFEST_FILE_NAME = "asset-manifest.json"

/** Manifest describing the source-owned Tiny Garden web bundle entrypoints. */
@Serializable
data class TinyGardenAssetManifest(
  val entryHtml: String,
  val scriptModule: String,
  val styleSheet: String,
  val bundleVersion: String,
)

/** Resolved Tiny Garden asset locations used by Android WebView hosts. */
data class TinyGardenResolvedAssetBundle(
  val assetBaseUrl: String,
  val assetPath: String,
  val entryHtml: String,
  val entryHtmlUrl: String,
  val scriptModule: String,
  val styleSheet: String,
) {
  /** Returns the entry page URL with an optional query string. */
  fun entryUrl(query: String = ""): String {
    return if (query.isBlank()) {
      entryHtmlUrl
    } else {
      "$entryHtmlUrl?$query"
    }
  }
}

/** Loader and resolver for the Tiny Garden asset bundle. */
object TinyGardenAssetBundle {
  private val json = Json {
    ignoreUnknownKeys = true
  }

  /** Loads the bundle manifest from app assets and resolves runtime URLs. */
  fun load(context: Context): Result<TinyGardenResolvedAssetBundle> {
    return runCatching {
      val assetPath = VertuRuntimeConfig.tinyGardenAssetPath
      val manifestPath = "$assetPath/$TINY_GARDEN_ASSET_MANIFEST_FILE_NAME"
      val manifest =
        context.assets
          .open(manifestPath)
          .bufferedReader()
          .use { reader ->
            json.decodeFromString<TinyGardenAssetManifest>(reader.readText())
          }
      resolve(
        manifest = manifest,
        assetBaseUrl = VertuRuntimeConfig.tinyGardenAssetBaseUrl,
        assetPath = assetPath,
      )
    }
  }

  /** Resolves normalized runtime URLs from a parsed bundle manifest. */
  internal fun resolve(
    manifest: TinyGardenAssetManifest,
    assetBaseUrl: String,
    assetPath: String,
  ): TinyGardenResolvedAssetBundle {
    val normalizedBaseUrl = assetBaseUrl.trim().trimEnd('/')
    val normalizedAssetPath = assetPath.trim().trim('/')
    val entryHtml = manifest.entryHtml.trim().ifBlank { "index.html" }
    return TinyGardenResolvedAssetBundle(
      assetBaseUrl = normalizedBaseUrl,
      assetPath = normalizedAssetPath,
      entryHtml = entryHtml,
      entryHtmlUrl = "$normalizedBaseUrl/$normalizedAssetPath/$entryHtml",
      scriptModule = manifest.scriptModule.trim(),
      styleSheet = manifest.styleSheet.trim(),
    )
  }
}
