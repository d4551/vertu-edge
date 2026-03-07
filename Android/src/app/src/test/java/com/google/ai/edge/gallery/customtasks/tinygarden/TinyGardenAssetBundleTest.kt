package com.google.ai.edge.gallery.customtasks.tinygarden

import java.nio.file.Files
import java.nio.file.Path
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TinyGardenAssetBundleTest {
  private val json = Json {
    ignoreUnknownKeys = true
  }

  @Test
  fun resolve_buildsStableEntryUrlFromManifest() {
    val manifest =
      TinyGardenAssetManifest(
        entryHtml = "index.html",
        scriptModule = "main.js",
        styleSheet = "styles.css",
        bundleVersion = "1.0.0",
      )

    val resolved =
      TinyGardenAssetBundle.resolve(
        manifest = manifest,
        assetBaseUrl = "https://appassets.androidplatform.net/",
        assetPath = "/assets/tinygarden/",
      )

    assertEquals("https://appassets.androidplatform.net", resolved.assetBaseUrl)
    assertEquals("assets/tinygarden", resolved.assetPath)
    assertEquals(
      "https://appassets.androidplatform.net/assets/tinygarden/index.html",
      resolved.entryHtmlUrl,
    )
    assertEquals(
      "https://appassets.androidplatform.net/assets/tinygarden/index.html?tutorial=1",
      resolved.entryUrl(query = "tutorial=1"),
    )
  }

  @Test
  fun sourceBundle_usesStableEntryFilenames() {
    val assetRoot =
      Path.of(
        "src",
        "app",
        "src",
        "main",
        "assets",
        "tinygarden",
      )
    val manifest =
      json.decodeFromString<TinyGardenAssetManifest>(
        Files.readString(assetRoot.resolve("asset-manifest.json"))
      )
    val indexHtml = Files.readString(assetRoot.resolve(manifest.entryHtml))

    assertEquals("main.js", manifest.scriptModule)
    assertEquals("styles.css", manifest.styleSheet)
    assertTrue(Files.exists(assetRoot.resolve(manifest.scriptModule)))
    assertTrue(Files.exists(assetRoot.resolve(manifest.styleSheet)))
    assertTrue(indexHtml.contains("href=\"styles.css\""))
    assertTrue(indexHtml.contains("src=\"main.js\""))
    assertFalse(indexHtml.contains("styles-"))
    assertFalse(indexHtml.contains("main-"))
  }
}
