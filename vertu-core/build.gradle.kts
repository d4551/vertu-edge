plugins {
  kotlin("multiplatform")
  kotlin("plugin.serialization")
}

kotlin {
  jvmToolchain(21)

  jvm()
  iosX64()
  iosArm64()
  iosSimulatorArm64()

  sourceSets {
    commonMain.dependencies {
      implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
      implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    }

    commonTest.dependencies {
      implementation(kotlin("test"))
    }
  }
}
