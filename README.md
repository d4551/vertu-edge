# Vertu Edge

> **AI-powered mobile automation. Precision crafted.**

Vertu Edge is a luxury mobile AI edge-to-edge RPA (Robotic Process Automation) system combining on-device generative AI with a YAML-driven automation flow engine — for Android and iOS.

---

## Features

- 🤖 **YAML Flow Engine** — Maestro-inspired automation with `launchApp`, `tapOn`, `inputText`, `assertVisible`, `scrollUntilVisible`, `openLink`, `runAiPrompt`, and more
- 🧠 **On-Device AI** — Google AI Edge / LiteRT (LiteRT) integration for local LLM inference, image classification, and audio transcription
- 🌐 **HuggingFace Integration** — Search, download, and cache `.litertlm` models directly from HuggingFace Hub
- 🎨 **Luxury UI** — Vertu-branded dark gold/black aesthetic with edge-to-edge Jetpack Compose (Android) and SwiftUI (iOS)
- 🔒 **Privacy First** — All AI inference runs on-device; no data leaves your phone

---

## Project Structure

```
vertu-edge/
├── Android/          # Android app (Kotlin + Jetpack Compose)
├── iOS/              # iOS app (Swift + SwiftUI)
├── flows/            # Example automation flows (YAML)
└── docs/             # Architecture and reference docs
```

---

## Getting Started

### Android

Requirements: Android Studio Hedgehog or later, JDK 17+

```bash
cd Android
./gradlew assembleDebug
```

### iOS

Requirements: Xcode 15+, Swift 5.9+

```bash
cd iOS
swift build
swift test
```

---

## Writing Flows

```yaml
appId: com.android.contacts
name: Create Contact
---
- launchApp: com.android.contacts
- tapOn: "Create new contact"
- tapOn: "First Name"
- inputText: "Jane"
- tapOn: "Save"
- assertVisible: "Jane"
- takeScreenshot: "done"
```

See [docs/flow-reference.md](docs/flow-reference.md) for the full flow reference.

---

## Architecture

See [docs/architecture.md](docs/architecture.md) for a full system architecture overview.

---

## License

Apache 2.0 — see [LICENSE](LICENSE).