# Development notes

## Build app locally (Android)

To successfully build and run the application through Android Studio, configure your own HuggingFace Developer Application ([official doc](https://huggingface.co/docs/hub/oauth#creating-an-oauth-app)). This is required for model download workflows.

### HuggingFace OAuth setup (step-by-step)

1. Go to [Hugging Face OAuth Apps](https://huggingface.co/settings/applications) and click "Create new application".
2. Set **Application name** (e.g. "Vertu Edge Dev").
3. Set **Redirect URL** to `comvertuedge://callback` (must match `VERTU_HF_REDIRECT_URI` in vertu.local.properties).
4. Set **App permissions** as needed (e.g. read access to gated models).
5. Create the app and copy the **Client ID**.
6. Set `VERTU_HF_CLIENT_ID` in `vertu.local.properties` to that Client ID.
7. Ensure `VERTU_HF_REDIRECT_SCHEME=comvertuedge` and `VERTU_HF_REDIRECT_URI=comvertuedge://callback` match the Redirect URL you configured.

After you've created a developer application:

1. **Copy the env template (optional):** `dev_bootstrap.sh` auto-copies `Android/src/vertu.local.properties.example` to `Android/src/vertu.local.properties` when missing. You can also copy manually. The root build script loads this file into Gradle project properties (see `Android/src/build.gradle.kts`). Alternatively, set the same keys as environment variables or in `Android/src/gradle.properties`.
2. Set HuggingFace OAuth values in `vertu.local.properties`:
   - `VERTU_HF_CLIENT_ID` (required)
   - `VERTU_HF_REDIRECT_URI` (e.g. `comvertuedge://callback`)
   - `VERTU_HF_REDIRECT_SCHEME` (e.g. `comvertuedge`)
3. Optionally set branding and app identifiers:
   - `VERTU_APP_NAME`, `VERTU_BRAND_TAGLINE`, `VERTU_APPLICATION_ID`, `VERTU_DEEP_LINK_SCHEME`
4. Build:
   `cd Android/src && ./gradlew :app:assembleDebug`
5. Install on device/emulator:
   `cd Android/src && ./gradlew :app:installDebug`

## Unified bootstrap

Use root scripts for repeatable setup and validation:

- `./scripts/dev_doctor.sh`
- `./scripts/dev_bootstrap.sh`

## Shared contracts and drivers

- `vertu-core`: KMP FlowV1 contract, YAML parser, error envelope, model manifest v2 contracts.
- `vertu-android-rpa`: Android UIAutomator driver implementing the shared adapter interface.
- `contracts/`: JSON schemas and fixtures for contract drift checks.

## Control plane

The control-plane dashboard runs on Bun. See `control-plane/README.md` for details.

- **Run:** `cd control-plane && bun run dev`
- **Port:** Set `CONTROL_PLANE_PORT` or `PORT` (default from `CONTROL_PLANE_DEFAULT_PORT` in `control-plane/src/config.ts`, typically `3310`). `dev_bootstrap.sh` and `launch.json` use this value.
- **Environment variables:** See `docs/ENV.md` for a full list of control-plane and script env vars.
- **Model source registry:** Configure pull sources in `control-plane/config/model-sources.json` (or override with `MODEL_SOURCE_REGISTRY_JSON`).
- **Optional local tools:** The Model Management card uses `ramalama` and can target Ollama sources when `ollama` is available locally.

## Bun tooling

- `tooling/vertu-flow-kit` provides:
- `vertu-flow validate <flow.yaml>`
- `vertu-flow compile <flow.yaml> [output.json]`
- `vertu-flow doctor`

Run:
`cd tooling/vertu-flow-kit && bun install && bun run typecheck && bun test`.

## iOS scaffold

`iOS/VertuEdge` contains the Swift package scaffold for FlowV1 contracts, SwiftUI shell, and XCTest driver target.
Run:
`cd iOS/VertuEdge && swift test`.

## TypeScript and lint quality checks

- **control-plane** and **tooling/vertu-flow-kit** use ESLint with typescript-eslint (flat config).
- Run `bun run lint` and `bun run lint:fix` in each package. CI enforces lint.
- `dev_bootstrap.sh` runs typecheck + lint before tests.

## Android lint

- Run `cd Android/src && ./gradlew :app:lintDebug` to check Kotlin/Android code quality.
- CI runs lint as part of the Android job.

## Java SDK (Android build)

Ensure Java 21 is installed. Scripts use a shared resolver in `scripts/lib/java21.sh` and prefer:
1. existing `JAVA_HOME` if it points to Java 21
2. `/usr/libexec/java_home -v 21` on macOS
3. Homebrew `openjdk@21` (`brew install openjdk@21`)

Set `JAVA_HOME` explicitly if needed:

```bash
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
```

Then run `cd Android/src && ./gradlew :app:assembleDebug`.

## Android SDK (build + tests)

Scripts use `scripts/lib/android_sdk.sh` to resolve/provision Android SDK tooling and write `Android/src/local.properties` automatically.

Resolution order:
1. `ANDROID_SDK_ROOT` / `ANDROID_HOME`
2. `$HOME/Library/Android/sdk` (macOS default)
3. `$HOME/Android/Sdk`
4. Homebrew cask root `/opt/homebrew/share/android-commandlinetools`

If SDK is missing, bootstrap scripts attempt to install `android-commandlinetools` and required packages (`platform-tools`, `platforms;android-35`, `build-tools;35.0.0`).

## i18n locale folders (Android)

Strings in `Android/src/app/src/main/res/values/strings.xml` are ready for translation (no `translatable="false"`). To add a locale when translations are available:

1. Create `Android/src/app/src/main/res/values-<locale>/strings.xml` (e.g. `values-es` for Spanish, `values-fr` for French).
2. Copy the structure from `values/strings.xml` and replace values with translated strings.
3. Android will automatically use the appropriate strings based on device locale.

## Using Context7 for docs

When adding new APIs, upgrading dependencies, or debugging, use the Context7 MCP (`resolve-library-id` + `query-docs`) to fetch current documentation for Elysia, Bun, ESLint, Gradle, Kotlin, or Swift. See `.cursor/rules/context7-docs.mdc` for the workflow.

## DaisyUI Blueprint MCP (control-plane)

When adding new control-plane UI components or tests, use the DaisyUI Blueprint MCP:

- **daisyUI-Snippets:** Use when adding new DaisyUI components (cards, forms, modals, tabs, etc.).
- **Figma-to-daisyUI:** Use when designs come from Figma.
- Apply to both UI components and any control-plane tests that assert HTML structure.

The control-plane uses DaisyUI 5 via local vendored assets in `control-plane/public/` (no CDN). MCP tools are in `mcps/user-daisyui-blueprint/`.

**No CDN for assets:** Control-plane assets are vendored locally via npm registry only. Run `./scripts/vendor_control_plane_assets.sh` to fetch latest daisyui, htmx, htmx-ext-sse, and @tailwindcss/browser from registry.npmjs.org (no CDN).

## Cross-Platform Contract Conventions

### Wire Format
- **FlowExecutionState**: kebab-case on the wire (`error-retryable`, not `ERROR_RETRYABLE` or `errorRetryable`)
  - TypeScript: string literal union
  - KMP: `@SerialName("error-retryable")` on enum entries
  - iOS: explicit raw values on enum cases
- **FlowCommand type discriminator**: camelCase (`tapOn`, `inputText`)
- **StepReport.commandType**: camelCase (e.g., `tapOn`, not `TapOn` or `tap_on`)

### Safety Policy
All platforms must evaluate flows through a safety policy before execution:
- Android: `VertuFlowSafetyPolicy.evaluate(flow)` in `VertuRpaFallbackExecutor`
- iOS: `FlowSafetyPolicy.evaluate(flow)` in `FlowRunnerView`
- Control-plane: Server-side flow validation in `flow-engine.ts`

### Testing Requirements
- All FlowCommand types must have Codable/serialization round-trip tests
- YAML parser must test all 15 command types + error paths
- Control-plane: `bun test` (75+ tests)
- iOS: `swift test` (36+ tests)
- Flow-kit: `bun test` (1+ test)

### Accessibility
- Control-plane: WCAG 2.1 AA minimum, DaisyUI 5 components, 44px touch targets
- Android: Material Design 3, TalkBack support, Role.Tab on category headers
- iOS: VoiceOver labels on all interactive elements, NavigationStack
