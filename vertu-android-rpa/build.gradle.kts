plugins {
  alias(libs.plugins.android.library)
  alias(libs.plugins.kotlin.android)
}

android {
  namespace = "com.vertu.edge.rpa"
  compileSdk = 35

  defaultConfig {
    minSdk = 31
    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_11
    targetCompatibility = JavaVersion.VERSION_11
  }

  kotlinOptions {
    jvmTarget = "11"
  }
}

dependencies {
  implementation(project(":vertu-core"))
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
  implementation("androidx.test.uiautomator:uiautomator:2.3.0")
  implementation("androidx.test:core:1.6.1")

  testImplementation("junit:junit:4.13.2")
}
