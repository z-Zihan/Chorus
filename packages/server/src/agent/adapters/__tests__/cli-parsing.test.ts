import { describe, expect, it } from "vitest";
import { formatJsonLine, parseCodexJson } from "../cli";

describe("formatJsonLine", () => {
  it("stringifies non-record events verbatim", () => {
    expect(formatJsonLine("hello")).toBe('"hello"');
    expect(formatJsonLine(42)).toBe("42");
    expect(formatJsonLine(null)).toBe("null");
    expect(formatJsonLine(["a", 1])).toBe('["a",1]');
  });

  it("drops system metadata and user echoes under any event-type key", () => {
    expect(formatJsonLine({ type: "system", subtype: "init", text: "config" })).toBeNull();
    expect(formatJsonLine({ type: "user", message: { content: "echo" } })).toBeNull();
    expect(formatJsonLine({ event: "system", text: "x" })).toBeNull();
    expect(formatJsonLine({ kind: "user", text: "x" })).toBeNull();
    expect(formatJsonLine({ sessionUpdate: "system", text: "x" })).toBeNull();
  });

  describe("assistant events", () => {
    it("returns trimmed string content", () => {
      expect(formatJsonLine({ type: "assistant", message: { content: "  hi there \n" } })).toBe(
        "hi there",
      );
    });

    it("returns null for blank string content", () => {
      expect(formatJsonLine({ type: "assistant", message: { content: "   " } })).toBeNull();
    });

    it("joins only text items from array content", () => {
      expect(
        formatJsonLine({
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "Hello " },
              { type: "tool_use", name: "Read", input: {} },
              "bare string",
              { type: "text", text: 7 },
              { type: "text", text: "world" },
            ],
          },
        }),
      ).toBe("Hello world");
    });

    it("returns null when array content has no text items", () => {
      expect(
        formatJsonLine({
          type: "assistant",
          message: { content: [{ type: "tool_use", name: "Read" }] },
        }),
      ).toBeNull();
      expect(formatJsonLine({ type: "assistant", message: { content: [] } })).toBeNull();
    });

    it("returns null when message is missing, not a record, or has non-text content", () => {
      expect(formatJsonLine({ type: "assistant" })).toBeNull();
      expect(formatJsonLine({ type: "assistant", message: "plain" })).toBeNull();
      expect(formatJsonLine({ type: "assistant", message: ["x"] })).toBeNull();
      expect(formatJsonLine({ type: "assistant", message: { content: 5 } })).toBeNull();
    });
  });

  it("skips result events to avoid duplicating assistant text", () => {
    expect(formatJsonLine({ type: "result", result: "final answer", is_error: false })).toBeNull();
  });

  describe("generic events", () => {
    it("renders tool_use names and recurses into tool_result content", () => {
      expect(
        formatJsonLine({
          type: "progress",
          message: {
            content: [
              { type: "tool_use", name: "Read" },
              { type: "tool_result", content: [{ type: "output", text: "file body" }] },
            ],
          },
        }),
      ).toBe("[progress] [tool] Readfile body");
    });

    it.each([
      "message",
      "response",
      "text",
      "delta",
      "content",
      "summary",
      "title",
      "command",
      "cmd",
      "error",
      "status",
    ])("reads direct text key %s", (key) => {
      expect(formatJsonLine({ type: "info", [key]: "  value  " })).toBe("[info] value");
    });

    it("concatenates multiple nested segments", () => {
      expect(
        formatJsonLine({
          type: "info",
          data: [{ text: "one" }, { summary: "two" }, { type: "user", text: "echo" }],
        }),
      ).toBe("[info] onetwo");
    });

    it("returns plain text for chunk/delta/partial events, case-insensitively", () => {
      expect(formatJsonLine({ type: "content_block_delta", delta: { text: "Hi" } })).toBe("Hi");
      expect(formatJsonLine({ type: "message_CHUNK", text: "abc" })).toBe("abc");
      expect(formatJsonLine({ event: "Partial", text: "xyz" })).toBe("xyz");
    });

    it("prefixes other typed events with their type", () => {
      expect(formatJsonLine({ type: "tool_call", command: "ls -la" })).toBe("[tool_call] ls -la");
      expect(formatJsonLine({ kind: "notice", text: "heads up" })).toBe("[notice] heads up");
    });

    it("returns bare text when no event type is present", () => {
      expect(formatJsonLine({ text: "plain" })).toBe("plain");
    });

    it("returns null when no text can be extracted", () => {
      expect(formatJsonLine({ type: "ping" })).toBeNull();
      expect(formatJsonLine({ type: "info", text: "   " })).toBeNull();
      expect(formatJsonLine({})).toBeNull();
      expect(formatJsonLine({ type: "info", data: { type: "system", text: "meta" } })).toBeNull();
    });
  });
});

describe("parseCodexJson", () => {
  it("stringifies non-record input", () => {
    expect(parseCodexJson("raw line")).toBe("raw line");
    expect(parseCodexJson(5)).toBe("5");
    expect(parseCodexJson(null)).toBe("null");
    expect(parseCodexJson([1, 2])).toBe("1,2");
  });

  it.each(["thread.started", "turn.started", "turn.completed"])(
    "skips lifecycle event %s",
    (type) => {
      expect(parseCodexJson({ type, message: "should not leak" })).toBe("");
    },
  );

  it("skips error events even when they carry a message", () => {
    expect(parseCodexJson({ type: "error", message: "Reconnecting... 1/5" })).toBe("");
  });

  describe("item.completed", () => {
    it("returns agent_message text verbatim", () => {
      expect(
        parseCodexJson({
          type: "item.completed",
          item: { id: "item_1", type: "agent_message", text: "  Hello  " },
        }),
      ).toBe("  Hello  ");
    });

    it("skips agent_message without string text", () => {
      expect(
        parseCodexJson({ type: "item.completed", item: { type: "agent_message", text: 1 } }),
      ).toBe("");
    });

    it.each(["tool_call", "reasoning", "command_execution"])("skips %s items", (itemType) => {
      expect(
        parseCodexJson({ type: "item.completed", item: { type: itemType, text: "internal" } }),
      ).toBe("");
    });

    it("skips non-record items", () => {
      expect(parseCodexJson({ type: "item.completed" })).toBe("");
      expect(parseCodexJson({ type: "item.completed", item: "text" })).toBe("");
      expect(parseCodexJson({ type: "item.completed", item: ["x"] })).toBe("");
    });
  });

  describe("message fallback", () => {
    it("returns a string message verbatim", () => {
      expect(parseCodexJson({ message: "hi" })).toBe("hi");
    });

    it("returns string message.content verbatim", () => {
      expect(parseCodexJson({ type: "response", message: { content: "body" } })).toBe("body");
    });

    it("joins string, text and tool_use items from array content", () => {
      expect(
        parseCodexJson({
          message: {
            content: [
              "a",
              { type: "text", text: "b" },
              { type: "tool_use", name: "Bash" },
              { type: "image", url: "x" },
              { type: "text", text: 3 },
              7,
            ],
          },
        }),
      ).toBe("ab[tool] Bash");
    });
  });

  it("returns empty string for unknown shapes", () => {
    expect(parseCodexJson({})).toBe("");
    expect(parseCodexJson({ type: "foo", data: { text: "x" } })).toBe("");
    expect(parseCodexJson({ message: 5 })).toBe("");
    expect(parseCodexJson({ message: { content: 5 } })).toBe("");
  });
});
