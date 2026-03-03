# Vertu Edge — Development Guide

## Prerequisites

### Android
- Android Studio Hedgehog (2023.1.1) or later
- JDK 17+
- Android SDK 35
- Kotlin 2.0+

### iOS
- Xcode 15+
- Swift 5.9+
- iOS 16+ simulator or device

---

## Android Development

### Build

```bash
cd Android
./gradlew assembleDebug         # Debug build
./gradlew assembleRelease       # Release build (requires signing)
./gradlew installDebug          # Install on connected device
```

### Test

```bash
./gradlew test                  # Unit tests
./gradlew connectedAndroidTest  # Instrumented tests
```

### Code Style

- Follow [Kotlin coding conventions](https://kotlinlang.org/docs/coding-conventions.html)
- Use `ktlint` for formatting: `./gradlew ktlintCheck`

### Project Setup

1. Clone the repository
2. Open `Android/` in Android Studio
3. Sync Gradle
4. Set up HuggingFace credentials in `ProjectConfig.kt`:
   ```kotlin
   const val HUGGING_FACE_CLIENT_ID = "your_client_id"
   ```

---

## iOS Development

### Build

```bash
cd iOS
swift build
```

### Test

```bash
swift test
```

### Open in Xcode

```bash
open iOS/Package.swift
```

---

## Flow Development

Flows are YAML files in the `flows/` directory. See [docs/flow-reference.md](docs/flow-reference.md) for the full reference.

### Running a Flow (Android)

1. Launch the app
2. Tap **Run Flow**
3. Paste your YAML into the editor
4. Tap the **▶** button

---

## Architecture

See [docs/architecture.md](docs/architecture.md) for a detailed architecture overview.

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes with descriptive messages
4. Push and open a Pull Request

---

## Release

### Android Release Build

1. Create a keystore:
   ```bash
   keytool -genkey -v -keystore vertu-release.jks -alias vertu -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Configure signing in `Android/app/build.gradle.kts`
3. Run `./gradlew bundleRelease`
