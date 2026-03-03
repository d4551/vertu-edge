# Vertu Edge — Flow Reference

Vertu Edge flows use a YAML syntax inspired by Maestro. Each flow file has a header section and an actions section separated by `---`.

## Flow File Structure

```yaml
# Header
appId: com.example.app        # Required: target app identifier
name: My Flow Name            # Optional: human-readable name

---
# Actions (one per line, prefixed with "- ")
- launchApp: com.example.app
- tapOn: "Button Text"
- inputText: "Hello, World!"
```

## Actions Reference

### `launchApp`
Launch an application by its package (Android) or bundle (iOS) identifier.
```yaml
- launchApp: com.example.myapp
```

### `tapOn`
Tap on a UI element matching the given text or accessibility label.
```yaml
- tapOn: "Sign In"
- tapOn: "Submit Button"
```

### `inputText`
Type text into the currently focused input field.
```yaml
- inputText: "john@example.com"
```

### `assertVisible`
Assert that a UI element is currently visible on screen.
```yaml
- assertVisible: "Welcome, John"
```

### `assertNotVisible`
Assert that a UI element is NOT visible on screen.
```yaml
- assertNotVisible: "Error Message"
```

### `scrollUntilVisible`
Scroll the screen until the specified element becomes visible.
```yaml
- scrollUntilVisible: "Load More"
```

### `openLink`
Open a URL in the system browser.
```yaml
- openLink: "https://vertu.com"
```

### `wait`
Wait for a specified number of milliseconds.
```yaml
- wait: 2000
```

### `pressKey`
Press a keyboard key by name.
```yaml
- pressKey: "Enter"
- pressKey: "Back"
```

### `runAiPrompt`
Send a prompt to the loaded on-device AI model.
```yaml
- runAiPrompt: "Summarize this text"
- runAiPrompt: "What is visible on screen?"
```

### `takeScreenshot`
Capture a screenshot with an optional label.
```yaml
- takeScreenshot: "login_success"
- takeScreenshot
```

### `clearState`
Clear the state (data/cache) of an application.
```yaml
- clearState: com.example.myapp
```

### `webAction`
Perform a web-based automation action.
```yaml
- webAction: click selector="#submit-btn"
- webAction: type value="hello" selector="input[name=email]"
```

## Complete Example

```yaml
appId: com.android.contacts
name: Create Contact Flow
---
- launchApp: com.android.contacts
- tapOn: "Create new contact"
- tapOn: "First Name"
- inputText: "Jane"
- tapOn: "Last Name"
- inputText: "Doe"
- tapOn: "Phone"
- inputText: "+1 555 000 0000"
- tapOn: "Save"
- assertVisible: "Jane Doe"
- takeScreenshot: "contact_saved"
```

## Tips

- Use double quotes around strings that contain spaces
- The `wait` action accepts milliseconds (e.g., `1000` = 1 second)
- AI prompts require a LiteRT model to be downloaded first
- All actions are executed sequentially; if one fails, the flow stops
