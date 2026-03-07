import type { AiWorkflowMode, AiWorkflowTextOptions } from "../../../contracts/flow-contracts";

const MODE_TITLES: Record<Exclude<AiWorkflowMode, "image">, string> = {
  chat: "general assistant",
  typography: "typography direction",
  presentation: "presentation customization",
  social: "social media copy",
  flow_generation: "Maestro YAML flow generation",
};

const FLOW_GENERATION_SYSTEM_PROMPT = `You are a Maestro YAML flow generator for mobile automation.
Given a natural language description, produce a valid Maestro YAML flow.

Available Maestro commands:
- launchApp: Launch the target application
- tapOn: Tap an element (by text, id, or accessibility label)
- scroll: Scroll in a direction
- assertVisible: Assert an element is visible on screen
- assertNotVisible: Assert an element is not visible
- inputText: Type text into a focused field
- back: Press the hardware back button
- hideKeyboard: Dismiss the on-screen keyboard
- takeScreenshot: Capture a screenshot with a label
- waitForAnimationToEnd: Wait for animations to complete
- swipe: Swipe in a direction
- openLink: Open a URL in the browser
- pressKey: Press a specific key

Output format:
- Wrap the generated YAML in a \`\`\`yaml code fence
- The YAML must start with \`appId:\` followed by the app package name
- Follow with \`---\` separator
- Then list the commands as a YAML array
- After the code fence, provide a brief explanation of what the flow does

Example:
\`\`\`yaml
appId: com.example.app
---
- launchApp
- tapOn:
    text: "Login"
- inputText: "user@example.com"
- tapOn:
    text: "Submit"
\`\`\``;

/** Build deterministic prompt text for a workflow mode and user input. */
export function buildWorkflowPrompt(
  mode: Exclude<AiWorkflowMode, "image">,
  message: string,
  options?: AiWorkflowTextOptions,
): string {
  if (mode === "flow_generation") {
    const lines: string[] = [];
    lines.push(FLOW_GENERATION_SYSTEM_PROMPT);
    if (options?.constraints?.trim()) {
      lines.push(`Constraints: ${options.constraints.trim()}`);
    }
    lines.push(`Generate a Maestro YAML flow for: ${message.trim()}`);
    return lines.join("\n");
  }

  const lines: string[] = [];
  lines.push(`You are generating ${MODE_TITLES[mode]} output.`);
  if (options?.audience?.trim()) {
    lines.push(`Audience: ${options.audience.trim()}`);
  }
  if (options?.tone?.trim()) {
    lines.push(`Tone: ${options.tone.trim()}`);
  }
  if (options?.format?.trim()) {
    lines.push(`Output format: ${options.format.trim()}`);
  }
  if (options?.constraints?.trim()) {
    lines.push(`Constraints: ${options.constraints.trim()}`);
  }
  lines.push("Return practical output with explicit structure and no filler.");
  lines.push(`Task: ${message.trim()}`);
  return lines.join("\n");
}

/** Extract YAML content from a markdown code fence in an AI response. */
export function extractYamlFromResponse(reply: string): string | null {
  const yamlFenceMatch = reply.match(/```(?:yaml|yml)\s*\n([\s\S]*?)```/);
  if (yamlFenceMatch?.[1]) {
    return yamlFenceMatch[1].trim();
  }
  // Try bare code fence
  const bareFenceMatch = reply.match(/```\s*\n([\s\S]*?)```/);
  if (bareFenceMatch?.[1] && bareFenceMatch[1].includes("appId:")) {
    return bareFenceMatch[1].trim();
  }
  return null;
}

/** Runtime guard for non-image workflow text modes. */
export function isTextWorkflowMode(mode: AiWorkflowMode): mode is Exclude<AiWorkflowMode, "image"> {
  return mode === "chat" || mode === "typography" || mode === "presentation" || mode === "social" || mode === "flow_generation";
}
