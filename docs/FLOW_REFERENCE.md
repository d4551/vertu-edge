# Flow Reference

## Supported commands
- `launchApp`
- `tapOn`
- `inputText`
- `assertVisible`
- `assertNotVisible`
- `assertText`
- `selectOption`
- `scroll`
- `swipe`
- `screenshot`
- `clipboardRead`
- `clipboardWrite`
- `windowFocus`
- `hideKeyboard`
- `waitForAnimation`

## Per-platform command support

Not all commands are available on every target platform. The matrix below shows which
commands are implemented in the control-plane adapters and the native RPA drivers.

| Command | Android | iOS | Desktop (macOS/Linux/Windows) |
| --- | --- | --- | --- |
| `launchApp` | yes | yes | yes |
| `tapOn` | yes (x/y coordinates) | yes (x/y coordinates) | no |
| `inputText` | yes | yes | no |
| `assertVisible` | yes | no | no |
| `assertNotVisible` | yes | no | no |
| `assertText` | yes | no | no |
| `selectOption` | yes | no | no |
| `scroll` | yes | no | no |
| `swipe` | yes | no | no |
| `screenshot` | yes | yes | yes |
| `clipboardRead` | no | no | yes |
| `clipboardWrite` | no | no | yes |
| `windowFocus` | no | no | yes |
| `hideKeyboard` | yes | no | no |
| `waitForAnimation` | yes | yes | yes |

### Notes

- **Android adapter** uses `adb` for all commands. `tapOn` requires x/y coordinates;
  the native Android RPA driver (`vertu-android-rpa`) supports text/resourceId/contentDescription selectors.
- **iOS adapter** in the control-plane supports 5 commands via `xcrun simctl`.
  The native `IosXcTestDriver` supports a broader set including assertions, scroll, swipe,
  selectOption, and hideKeyboard via XCUITest APIs.
- **Desktop adapter** supports clipboard and window management commands via platform-native
  tools (`pbcopy`/`pbpaste` on macOS, `xclip`/`wmctrl` on Linux, PowerShell on Windows).

## API routes
- `/api/flows/validate`
- `/api/flows/validate/automation`
- `/api/flows/capabilities`
- `/api/flows/run`
- `/api/flows/trigger`
- `/api/flows/runs`
- `/api/flows/runs/:runId`
- `/api/flows/runs/:runId/cancel`
- `/api/flows/runs/:runId/pause`
- `/api/flows/runs/:runId/resume`
- `/api/flows/runs/:runId/replay-step`
- `/api/flows/runs/:runId/logs`
- `/api/models/pull`
- `/api/models/pull/:jobId`
- `/api/models/sources`
- `/api/apps/build`
- `/api/apps/build/:jobId`
- `/api/ai/providers/validate`
