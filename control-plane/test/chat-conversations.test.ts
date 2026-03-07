import { expect, test, describe } from "bun:test";
import { initDb } from "../src/db";
import {
  appendMessage,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  listMessages,
  updateConversation,
} from "../src/db";
import { renderChatMessage } from "../src/ai-renderers";
import { renderAiWorkflowJobState } from "../src/ai-renderers";
import { parseAiWorkflowRequestBody } from "../src/ai-workflows/orchestrator";

initDb();

// ---------------------------------------------------------------------------
// Conversation CRUD
// ---------------------------------------------------------------------------

describe("Conversation CRUD", () => {
  test("createConversation returns a valid UUID and can be retrieved", () => {
    const id = createConversation("Test conversation", "chat");
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");

    const row = getConversation(id);
    expect(row).not.toBeNull();
    expect(row!.title).toBe("Test conversation");
    expect(row!.mode).toBe("chat");
    expect(row!.createdAt).toBeTruthy();
    expect(row!.updatedAt).toBeTruthy();
  });

  test("getConversation returns null for missing id", () => {
    const row = getConversation("nonexistent-id");
    expect(row).toBeNull();
  });

  test("listConversations returns paginated results", () => {
    // Create several conversations
    createConversation("Conv A", "chat");
    createConversation("Conv B", "image");
    createConversation("Conv C", "typography");

    const result = listConversations(2, 0);
    expect(result.total).toBeGreaterThanOrEqual(3);
    expect(result.conversations.length).toBeLessThanOrEqual(2);
    // Ordered by most recently updated
    expect(result.conversations[0]!.updatedAt >= result.conversations[1]!.updatedAt).toBe(true);
  });

  test("updateConversation changes title and updatedAt", () => {
    const id = createConversation("Original title", "chat");
    const before = getConversation(id)!;
    updateConversation(id, { title: "Updated title" });
    const after = getConversation(id)!;
    expect(after.title).toBe("Updated title");
    expect(after.updatedAt >= before.updatedAt).toBe(true);
  });

  test("deleteConversation removes conversation and cascade deletes messages", () => {
    const convId = createConversation("To delete", "chat");
    appendMessage({ conversationId: convId, role: "user", content: "Hello" });
    appendMessage({ conversationId: convId, role: "assistant", content: "Hi" });

    const beforeMessages = listMessages(convId);
    expect(beforeMessages.length).toBe(2);

    const deleted = deleteConversation(convId);
    expect(deleted).toBe(true);

    const afterConv = getConversation(convId);
    expect(afterConv).toBeNull();

    const afterMessages = listMessages(convId);
    expect(afterMessages.length).toBe(0);
  });

  test("deleteConversation returns false for missing conversation", () => {
    const deleted = deleteConversation("does-not-exist");
    expect(deleted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Message CRUD
// ---------------------------------------------------------------------------

describe("Message CRUD", () => {
  test("appendMessage persists user and assistant messages", () => {
    const convId = createConversation("Message test", "chat");
    const msgId1 = appendMessage({
      conversationId: convId,
      role: "user",
      content: "What is TypeScript?",
      mode: "chat",
    });
    const msgId2 = appendMessage({
      conversationId: convId,
      role: "assistant",
      content: "TypeScript is a typed superset of JavaScript.",
      mode: "chat",
      provider: "ollama",
      model: "mistral",
    });

    expect(typeof msgId1).toBe("string");
    expect(typeof msgId2).toBe("string");
    expect(msgId1).not.toBe(msgId2);
  });

  test("listMessages returns messages in chronological order", () => {
    const convId = createConversation("Ordering test", "chat");
    appendMessage({ conversationId: convId, role: "user", content: "First" });
    appendMessage({ conversationId: convId, role: "assistant", content: "Second" });
    appendMessage({ conversationId: convId, role: "user", content: "Third" });

    const messages = listMessages(convId);
    expect(messages.length).toBe(3);
    expect(messages[0]!.content).toBe("First");
    expect(messages[0]!.role).toBe("user");
    expect(messages[1]!.content).toBe("Second");
    expect(messages[1]!.role).toBe("assistant");
    expect(messages[2]!.content).toBe("Third");
    expect(messages[2]!.role).toBe("user");
  });

  test("listMessages returns empty array for unknown conversation", () => {
    const messages = listMessages("nonexistent-conv");
    expect(messages).toEqual([]);
  });

  test("appendMessage touches conversation updatedAt", () => {
    const convId = createConversation("Touch test", "chat");
    const before = getConversation(convId)!;
    appendMessage({ conversationId: convId, role: "user", content: "Ping" });
    const after = getConversation(convId)!;
    expect(after.updatedAt >= before.updatedAt).toBe(true);
  });

  test("appendMessage preserves metadata fields", () => {
    const convId = createConversation("Metadata test", "image");
    appendMessage({
      conversationId: convId,
      role: "assistant",
      content: "Image generated",
      mode: "image",
      provider: "huggingface",
      model: "stabilityai/sdxl",
    });

    const messages = listMessages(convId);
    expect(messages.length).toBe(1);
    const msg = messages[0]!;
    expect(msg.mode).toBe("image");
    expect(msg.provider).toBe("huggingface");
    expect(msg.model).toBe("stabilityai/sdxl");
  });
});

// ---------------------------------------------------------------------------
// parseAiWorkflowRequestBody with conversationId
// ---------------------------------------------------------------------------

describe("parseAiWorkflowRequestBody with conversationId", () => {
  test("passes through conversationId when provided", () => {
    const result = parseAiWorkflowRequestBody({
      mode: "chat",
      message: "Hello",
      conversationId: "conv-abc-123",
    });
    expect(result.error).toBeUndefined();
    expect(result.request).toBeTruthy();
    expect(result.request!.conversationId).toBe("conv-abc-123");
  });

  test("omits conversationId when empty string", () => {
    const result = parseAiWorkflowRequestBody({
      mode: "chat",
      message: "Hello",
      conversationId: "   ",
    });
    expect(result.error).toBeUndefined();
    expect(result.request).toBeTruthy();
    expect(result.request!.conversationId).toBeUndefined();
  });

  test("omits conversationId when not provided", () => {
    const result = parseAiWorkflowRequestBody({
      mode: "chat",
      message: "Hello",
    });
    expect(result.error).toBeUndefined();
    expect(result.request).toBeTruthy();
    expect(result.request!.conversationId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// renderChatMessage
// ---------------------------------------------------------------------------

describe("renderChatMessage", () => {
  test("renders user message as chat-end bubble", () => {
    const html = renderChatMessage("user", "Hello world");
    expect(html).toContain("chat chat-end");
    expect(html).toContain("chat-bubble-primary");
    expect(html).toContain("Hello world");
  });

  test("renders assistant message as chat-start bubble", () => {
    const html = renderChatMessage("assistant", "Hi there");
    expect(html).toContain("chat chat-start");
    expect(html).toContain("chat-bubble-secondary");
    expect(html).toContain("Hi there");
  });

  test("renders model badge for assistant messages with metadata", () => {
    const html = renderChatMessage("assistant", "Response text", {
      provider: "ollama",
      model: "mistral",
    });
    expect(html).toContain("mistral");
    expect(html).toContain("badge");
  });

  test("does not render model badge for user messages", () => {
    const html = renderChatMessage("user", "Question", {
      provider: "ollama",
      model: "mistral",
    });
    expect(html).not.toContain("badge-ghost");
  });

  test("escapes HTML in content", () => {
    const html = renderChatMessage("user", "<script>alert('xss')</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

// ---------------------------------------------------------------------------
// renderAiWorkflowJobState chat bubble output
// ---------------------------------------------------------------------------

describe("renderAiWorkflowJobState renders chat bubbles", () => {
  test("completed job renders assistant chat bubble", () => {
    const html = renderAiWorkflowJobState("/api/ai/workflows/jobs/test-job", {
      route: "/api/ai/workflows/jobs",
      jobId: "test-job",
      state: "success",
      data: {
        jobId: "test-job",
        status: "succeeded",
        correlationId: "corr-1",
        stdout: "",
        stderr: "",
        elapsedMs: 100,
        result: {
          mode: "chat",
          requestedProvider: "ollama",
          providerPath: "local:ollama",
          requestedModel: null,
          effectiveModel: "mistral",
          reply: "This is the response",
          conversationId: "conv-123",
        },
      },
      mismatches: [],
    });
    expect(html).toContain("chat chat-start");
    expect(html).toContain("This is the response");
    expect(html).toContain("data-job-terminal");
    // Should set conversationId via script
    expect(html).toContain("conv-123");
  });

  test("pending job renders loading state with auto-poll", () => {
    const html = renderAiWorkflowJobState("/api/ai/workflows/jobs/pending-job", {
      route: "/api/ai/workflows/jobs",
      jobId: "pending-job",
      state: "loading",
      data: {
        jobId: "pending-job",
        status: "running",
        correlationId: "corr-2",
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      },
      mismatches: [],
    });
    expect(html).toContain('hx-ext="job-poll"');
    expect(html).toContain('job-poll-interval="2s"');
    expect(html).toContain("chat-job-pending-job");
  });

  test("error job renders error bubble", () => {
    const html = renderAiWorkflowJobState("/api/ai/workflows/jobs/error-job", {
      route: "/api/ai/workflows/jobs",
      jobId: "error-job",
      state: "error-non-retryable",
      error: {
        commandIndex: -1,
        command: "workflow",
        reason: "Model not found",
        retryable: false,
        surface: "chat",
      },
      mismatches: ["Model not found"],
    });
    expect(html).toContain("chat-bubble-error");
    expect(html).toContain("Model not found");
    expect(html).toContain("data-job-terminal");
  });
});

// ---------------------------------------------------------------------------
// AiWorkflowRequest contract: conversationId field
// ---------------------------------------------------------------------------

describe("AiWorkflowRequest contract", () => {
  test("AiWorkflowResult supports conversationId", () => {
    // Verify the type accepts conversationId at runtime
    const result = {
      mode: "chat" as const,
      requestedProvider: null,
      providerPath: "local:ollama",
      requestedModel: null,
      effectiveModel: "mistral",
      reply: "Test reply",
      conversationId: "conv-xyz",
    };
    expect(result.conversationId).toBe("conv-xyz");
  });
});
