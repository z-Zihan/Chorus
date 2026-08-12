import { describe, expect, it } from "vitest";
import { sanitizeLogValue } from "../logging";

describe("sanitizeLogValue", () => {
  it("redacts sensitive keys recursively", () => {
    expect(
      sanitizeLogValue({
        authorization: "Bearer abc",
        nested: { apiKey: "sk-secret", safe: "visible" },
      }),
    ).toEqual({
      authorization: "[REDACTED]",
      nested: { apiKey: "[REDACTED]", safe: "visible" },
    });
  });

  it("redacts credentials embedded in messages and errors", () => {
    const result = sanitizeLogValue(new Error("token=abc123 Bearer top-secret"));
    expect(result).toMatchObject({
      name: "Error",
      message: "token=[REDACTED] Bearer [REDACTED]",
    });
  });

  it("handles circular data without throwing", () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    expect(sanitizeLogValue(value)).toEqual({ self: "[CIRCULAR]" });
  });

  it("keeps uncommon values JSON serializable", () => {
    expect(
      JSON.stringify(sanitizeLogValue({ count: 42n, createdAt: new Date("2026-08-12T00:00:00Z") })),
    ).toBe('{"count":"42","createdAt":"2026-08-12T00:00:00.000Z"}');
  });
});
