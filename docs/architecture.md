# Vertu Edge — Architecture

## Overview

Vertu Edge is a cross-platform mobile AI edge-to-edge automation and RPA system. It combines on-device AI inference (via Google AI Edge / LiteRT) with a Maestro-inspired YAML flow engine for iOS and Android.

## System Components

```
┌─────────────────────────────────────────────────────────┐
│                     Vertu Edge App                       │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │   Flow UI   │  │  Model UI    │  │   Home UI     │  │
│  └──────┬──────┘  └──────┬───────┘  └───────────────┘  │
│         │                │                              │
│  ┌──────▼──────┐  ┌──────▼────────────────────────┐   │
│  │ FlowRunner  │  │   HuggingFace Repository       │   │
│  │  ViewModel  │  │   (Search + Download)          │   │
│  └──────┬──────┘  └──────────────────────────────┘    │
│         │                                              │
│  ┌──────▼──────────────────────┐                       │
│  │     VertuFlowEngine          │                       │
│  │  ┌──────────┐ ┌──────────┐  │                       │
│  │  │FlowParser│ │ Actions  │  │                       │
│  │  └──────────┘ └──────────┘  │                       │
│  └─────────────────────────────┘                       │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │           Google AI Edge / LiteRT                 │   │
│  │        LLM Inference API (On-Device)              │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Flow Engine

The flow engine is inspired by Maestro's YAML-based approach and parses flows into a series of `FlowAction` values executed sequentially.

### Supported Actions

| Action | Description |
|--------|-------------|
| `launchApp` | Launch an app by package/bundle ID |
| `tapOn` | Tap a UI element by text/accessibility label |
| `inputText` | Enter text into the focused input |
| `assertVisible` | Assert an element is visible |
| `assertNotVisible` | Assert an element is not visible |
| `scrollUntilVisible` | Scroll until an element is visible |
| `openLink` | Open a URL in the browser |
| `wait` | Wait for a duration (ms) |
| `pressKey` | Press a keyboard key |
| `runAiPrompt` | Run an AI prompt on the loaded model |
| `webAction` | Perform a web-based action |
| `takeScreenshot` | Capture a screenshot |
| `clearState` | Clear app state |

## AI Integration

Vertu Edge integrates Google AI Edge's LiteRT runtime for on-device inference:
- **Model Format**: `.litertlm` (LiteRT model format)
- **Tasks**: Text generation, image classification, audio transcription
- **Source**: HuggingFace model hub (litert-community)

## HuggingFace Integration

Models are sourced from HuggingFace:
1. OAuth authentication with HuggingFace
2. Model search via HuggingFace API
3. Progressive download with progress tracking
4. Local model caching
5. Offline model enumeration

## Platform Support

| Feature | Android | iOS |
|---------|---------|-----|
| Flow Engine | ✅ Kotlin | ✅ Swift |
| UI | ✅ Jetpack Compose | ✅ SwiftUI |
| HuggingFace Download | ✅ | ✅ |
| LiteRT Inference | ✅ | ✅ |
| Edge-to-Edge UI | ✅ | ✅ |
