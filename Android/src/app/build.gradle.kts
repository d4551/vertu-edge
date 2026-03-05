/*
 * Copyright 2025 Google LLC
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

plugins {
  alias(libs.plugins.android.application)
  // Note: set apply to true to enable google-services (requires google-services.json).
  alias(libs.plugins.google.services) apply false
  alias(libs.plugins.kotlin.android)
  alias(libs.plugins.kotlin.compose)
  alias(libs.plugins.kotlin.serialization)
  alias(libs.plugins.protobuf)
  alias(libs.plugins.hilt.application)
  alias(libs.plugins.oss.licenses)
  kotlin("kapt")
}

fun resolveConfig(name: String, defaultValue: String): String {
  return project.findProperty(name)?.toString()
    ?: providers.gradleProperty(name).orNull
    ?: System.getenv(name)
    ?: defaultValue
}

fun buildConfigString(value: String): String {
  val escaped = value.replace("\\", "\\\\").replace("\"", "\\\"")
  return "\"$escaped\""
}

val vertuAppName = resolveConfig(name = "VERTU_APP_NAME", defaultValue = "Vertu Edge")
val vertuTagline =
  resolveConfig(
    name = "VERTU_BRAND_TAGLINE",
    defaultValue = "Concierge-grade mobile automation",
  )
val vertuAppId = resolveConfig(name = "VERTU_APPLICATION_ID", defaultValue = "com.vertu.edge")
val vertuDeepLinkScheme = resolveConfig(name = "VERTU_DEEP_LINK_SCHEME", defaultValue = "com.vertu.edge")
val vertuHfRedirectScheme =
  resolveConfig(name = "VERTU_HF_REDIRECT_SCHEME", defaultValue = "comvertuedge")
val vertuHfClientId = resolveConfig(name = "VERTU_HF_CLIENT_ID", defaultValue = "")
if (vertuHfClientId.isBlank()) {
  logger.warn("VERTU_HF_CLIENT_ID is not set. HuggingFace OAuth will not work.")
}
val vertuHfRedirectUri =
  resolveConfig(name = "VERTU_HF_REDIRECT_URI", defaultValue = "$vertuHfRedirectScheme://callback")
val vertuHfBaseUrl = resolveConfig(
  name = "VERTU_HF_BASE_URL",
  defaultValue = "https://huggingface.co",
)
val vertuModelAllowlistBaseUrl = resolveConfig(
  name = "VERTU_MODEL_ALLOWLIST_BASE_URL",
  defaultValue = "https://raw.githubusercontent.com/google-ai-edge/gallery/refs/heads/main/model_allowlists",
)
val vertuControlPlaneBaseUrl = resolveConfig(
  name = "VERTU_CONTROL_PLANE_BASE_URL",
  defaultValue = "http://127.0.0.1:3310",
)
val vertuControlPlaneConnectTimeoutMs = resolveConfig(
  name = "VERTU_CONTROL_PLANE_CONNECT_TIMEOUT_MS",
  defaultValue = "15000",
)
val vertuControlPlaneReadTimeoutMs = resolveConfig(
  name = "VERTU_CONTROL_PLANE_READ_TIMEOUT_MS",
  defaultValue = "30000",
)
val vertuControlPlanePollIntervalMs = resolveConfig(
  name = "VERTU_CONTROL_PLANE_POLL_INTERVAL_MS",
  defaultValue = "900",
)
val vertuControlPlanePollAttempts = resolveConfig(
  name = "VERTU_CONTROL_PLANE_POLL_ATTEMPTS",
  defaultValue = "180",
)
val vertuControlPlaneDefaultPullTimeoutMs = resolveConfig(
  name = "VERTU_CONTROL_PLANE_DEFAULT_PULL_TIMEOUT_MS",
  defaultValue = "120000",
)
val vertuControlPlaneDefaultModelSource = resolveConfig(
  name = "VERTU_CONTROL_PLANE_DEFAULT_MODEL_SOURCE",
  defaultValue = "",
)
val vertuControlPlaneModelStateIdPrefix = resolveConfig(
  name = "VERTU_CONTROL_PLANE_MODEL_STATE_ID_PREFIX",
  defaultValue = "model-state",
)

android {
  namespace = "com.google.ai.edge.gallery"
  compileSdk = 35

  defaultConfig {
    applicationId = vertuAppId
    minSdk = 31
    targetSdk = 35
    versionCode = 19
    versionName = "1.0.10"

    // Needed for HuggingFace auth workflows.
    // Use the scheme of the "Redirect URLs" in HuggingFace app.
    manifestPlaceholders["appAuthRedirectScheme"] = vertuHfRedirectScheme
    manifestPlaceholders["deepLinkScheme"] = vertuDeepLinkScheme
    manifestPlaceholders["applicationName"] = "com.google.ai.edge.gallery.GalleryApplication"

    buildConfigField("String", "VERTU_APP_NAME", buildConfigString(vertuAppName))
    buildConfigField("String", "VERTU_BRAND_TAGLINE", buildConfigString(vertuTagline))
    buildConfigField("String", "VERTU_APPLICATION_ID", buildConfigString(vertuAppId))
    buildConfigField("String", "VERTU_DEEP_LINK_SCHEME", buildConfigString(vertuDeepLinkScheme))
    buildConfigField("String", "VERTU_HF_CLIENT_ID", buildConfigString(vertuHfClientId))
    buildConfigField("String", "VERTU_HF_REDIRECT_URI", buildConfigString(vertuHfRedirectUri))
    buildConfigField("String", "VERTU_HF_REDIRECT_SCHEME", buildConfigString(vertuHfRedirectScheme))
    buildConfigField("String", "VERTU_HF_BASE_URL", buildConfigString(vertuHfBaseUrl))
    buildConfigField(
      "String",
      "VERTU_MODEL_ALLOWLIST_BASE_URL",
      buildConfigString(vertuModelAllowlistBaseUrl),
    )
    buildConfigField(
      "String",
      "VERTU_CONTROL_PLANE_BASE_URL",
      buildConfigString(vertuControlPlaneBaseUrl),
    )
    buildConfigField(
      "int",
      "VERTU_CONTROL_PLANE_CONNECT_TIMEOUT_MS",
      vertuControlPlaneConnectTimeoutMs,
    )
    buildConfigField(
      "int",
      "VERTU_CONTROL_PLANE_READ_TIMEOUT_MS",
      vertuControlPlaneReadTimeoutMs,
    )
    buildConfigField(
      "int",
      "VERTU_CONTROL_PLANE_POLL_INTERVAL_MS",
      vertuControlPlanePollIntervalMs,
    )
    buildConfigField(
      "int",
      "VERTU_CONTROL_PLANE_POLL_ATTEMPTS",
      vertuControlPlanePollAttempts,
    )
    buildConfigField(
      "int",
      "VERTU_CONTROL_PLANE_DEFAULT_PULL_TIMEOUT_MS",
      vertuControlPlaneDefaultPullTimeoutMs,
    )
    buildConfigField(
      "String",
      "VERTU_CONTROL_PLANE_DEFAULT_MODEL_SOURCE",
      buildConfigString(vertuControlPlaneDefaultModelSource),
    )
    buildConfigField(
      "String",
      "VERTU_CONTROL_PLANE_MODEL_STATE_ID_PREFIX",
      buildConfigString(vertuControlPlaneModelStateIdPrefix),
    )

    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
  }

  signingConfigs {
    create("release") {
      val keystorePath = resolveConfig("VERTU_RELEASE_KEYSTORE_FILE", "")
      if (keystorePath.isNotBlank()) {
        storeFile = file(keystorePath)
        storePassword = resolveConfig("VERTU_RELEASE_KEYSTORE_PASSWORD", "")
        keyAlias = resolveConfig("VERTU_RELEASE_KEY_ALIAS", "")
        keyPassword = resolveConfig("VERTU_RELEASE_KEY_PASSWORD", "")
      }
    }
  }

  buildTypes {
    release {
      isMinifyEnabled = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
      val releaseConfig = signingConfigs.findByName("release")
      val hasReleaseKeystore = releaseConfig?.storeFile?.exists() == true
      signingConfig = if (hasReleaseKeystore) releaseConfig else signingConfigs.getByName("debug")
      if (!hasReleaseKeystore) {
        logger.warn(
          "Release build is using debug signing. " +
            "Set VERTU_RELEASE_KEYSTORE_FILE, VERTU_RELEASE_KEYSTORE_PASSWORD, " +
            "VERTU_RELEASE_KEY_ALIAS, and VERTU_RELEASE_KEY_PASSWORD for production builds."
        )
      }
    }
  }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_11
    targetCompatibility = JavaVersion.VERSION_11
  }
  kotlinOptions {
    jvmTarget = "11"
    freeCompilerArgs += "-Xcontext-receivers"
  }
  buildFeatures {
    compose = true
    buildConfig = true
  }
}

dependencies {
  implementation(project(":vertu-core"))
  implementation(project(":vertu-android-rpa"))
  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.lifecycle.runtime.ktx)
  implementation(libs.androidx.activity.compose)
  implementation(platform(libs.androidx.compose.bom))
  implementation(libs.androidx.ui)
  implementation(libs.androidx.ui.graphics)
  implementation(libs.androidx.ui.tooling.preview)
  implementation(libs.androidx.material3)
  implementation(libs.androidx.compose.navigation)
  implementation(libs.kotlinx.serialization.json)
  implementation(libs.kotlin.reflect)
  implementation(libs.material.icon.extended)
  implementation(libs.androidx.work.runtime)
  implementation(libs.hilt.work)
  implementation(libs.androidx.datastore)
  implementation(libs.com.google.code.gson)
  implementation(libs.androidx.lifecycle.process)
  implementation(libs.androidx.security.crypto)
  implementation(libs.androidx.webkit)
  implementation(libs.litertlm)
  implementation(libs.commonmark)
  implementation(libs.richtext)
  implementation(libs.tflite)
  implementation(libs.tflite.gpu)
  implementation(libs.tflite.support)
  implementation(libs.camerax.core)
  implementation(libs.camerax.camera2)
  implementation(libs.camerax.lifecycle)
  implementation(libs.camerax.view)
  implementation(libs.openid.appauth)
  implementation(libs.androidx.splashscreen)
  implementation(libs.protobuf.javalite)
  implementation(libs.hilt.android)
  implementation(libs.hilt.navigation.compose)
  implementation(libs.play.services.oss.licenses)
  implementation(platform(libs.firebase.bom))
  implementation(libs.firebase.analytics)
  implementation(libs.androidx.exifinterface)
  kapt(libs.hilt.android.compiler)
  testImplementation(libs.junit)
  androidTestImplementation(libs.androidx.junit)
  androidTestImplementation(libs.androidx.espresso.core)
  androidTestImplementation(platform(libs.androidx.compose.bom))
  androidTestImplementation(libs.androidx.ui.test.junit4)
  androidTestImplementation(libs.hilt.android.testing)
  debugImplementation(libs.androidx.ui.tooling)
  debugImplementation(libs.androidx.ui.test.manifest)
}

protobuf {
  protoc { artifact = "com.google.protobuf:protoc:4.26.1" }
  generateProtoTasks { all().forEach { it.plugins { create("java") { option("lite") } } } }
}
