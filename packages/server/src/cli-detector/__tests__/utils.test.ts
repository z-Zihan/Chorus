import { normalize } from "node:path";
import { describe, expect, it } from "vitest";
import {
  abortError,
  appendLimited,
  firstOutputLine,
  normalizeForComparison,
  throwIfAborted,
} from "../utils.js";

const MAX_OUTPUT_BYTES = 64 * 1024;

describe("appendLimited", () => {
  it("appends the first chunk to an empty buffer", () => {
    const result = appendLimited(Buffer.alloc(0), Buffer.from("hello"));

    expect(result.toString()).toBe("hello");
  });

  it("truncates a single oversized chunk to 64KB", () => {
    const chunk = Buffer.alloc(MAX_OUTPUT_BYTES + 100, "a");

    const result = appendLimited(Buffer.alloc(0), chunk);

    expect(result.length).toBe(MAX_OUTPUT_BYTES);
    expect(result.equals(chunk.subarray(0, MAX_OUTPUT_BYTES))).toBe(true);
  });

  it("returns the current buffer unchanged once the limit is reached", () => {
    const full = Buffer.alloc(MAX_OUTPUT_BYTES, "a");

    const result = appendLimited(full, Buffer.from("more"));

    expect(result).toBe(full);
    expect(result.length).toBe(MAX_OUTPUT_BYTES);
  });

  it("never exceeds the limit across repeated appends", () => {
    let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    const chunk = Buffer.alloc(10_000, "b");

    for (let i = 0; i < 10; i += 1) {
      buffer = appendLimited(buffer, chunk);
      expect(buffer.length).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
    }

    expect(buffer.length).toBe(MAX_OUTPUT_BYTES);
  });
});

describe("firstOutputLine", () => {
  it("skips leading blank lines and returns the first non-empty line", () => {
    expect(firstOutputLine("\n   \n\t\nv1.2.3\nsecond")).toBe("v1.2.3");
  });

  it("trims the returned line", () => {
    expect(firstOutputLine("   claude 1.0.0   \nnext")).toBe("claude 1.0.0");
  });

  it("truncates lines longer than 240 characters", () => {
    const line = "x".repeat(300);

    expect(firstOutputLine(line)).toBe("x".repeat(240));
  });

  it("handles CRLF line endings", () => {
    expect(firstOutputLine("\r\n\r\ncodex 0.5.0\r\nother\r\n")).toBe("codex 0.5.0");
  });

  it("returns undefined for whitespace-only input", () => {
    expect(firstOutputLine("")).toBeUndefined();
    expect(firstOutputLine(" \n\t\r\n  ")).toBeUndefined();
  });
});

describe("normalizeForComparison", () => {
  it.runIf(process.platform === "win32")("lowercases normalized paths on Windows", () => {
    expect(normalizeForComparison("C:\\Tools\\Bin\\..\\Claude.EXE")).toBe(
      normalize("C:\\Tools\\Bin\\..\\Claude.EXE").toLowerCase(),
    );
  });

  it.runIf(process.platform !== "win32")("only normalizes paths on non-Windows platforms", () => {
    const input = "/usr//Local/./Bin/../bin/Claude";

    expect(normalizeForComparison(input)).toBe(normalize(input));
    expect(normalizeForComparison(input)).toBe("/usr/Local/bin/Claude");
  });
});

describe("throwIfAborted", () => {
  it("does not throw without a signal", () => {
    expect(() => throwIfAborted(undefined)).not.toThrow();
  });

  it("does not throw for a signal that is not aborted", () => {
    expect(() => throwIfAborted(new AbortController().signal)).not.toThrow();
  });

  it("throws an AbortError for an aborted signal", () => {
    const controller = new AbortController();
    controller.abort();

    expect(() => throwIfAborted(controller.signal)).toThrow(
      expect.objectContaining({ name: "AbortError" }),
    );
  });
});

describe("abortError", () => {
  it("returns an Error named AbortError", () => {
    const error = abortError();

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AbortError");
  });
});
