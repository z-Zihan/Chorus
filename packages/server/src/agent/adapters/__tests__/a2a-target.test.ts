import { describe, expect, it } from "vitest";
import { resolveA2ATarget } from "../a2a-target";

describe("resolveA2ATarget", () => {
  const ids = ["writer", "Reviewer", "codex-1"];

  it("matches ids case-insensitively and ignores surrounding whitespace in the target", () => {
    expect(resolveA2ATarget("writer", ids)).toBe("writer");
    expect(resolveA2ATarget("  WRITER\t", ids)).toBe("writer");
    expect(resolveA2ATarget("reviewer", ids)).toBe("Reviewer");
  });

  it("matches display names case-insensitively and returns the id", () => {
    const names = { writer: "Story Writer", "codex-1": "  Codex Bot  " };
    expect(resolveA2ATarget("story writer", ids, names)).toBe("writer");
    expect(resolveA2ATarget(" CODEX BOT ", ids, names)).toBe("codex-1");
  });

  it("prefers an id match over another agent's display name", () => {
    const names = { writer: "Reviewer" };
    expect(resolveA2ATarget("reviewer", ids, names)).toBe("Reviewer");
  });

  it("returns undefined for blank targets", () => {
    expect(resolveA2ATarget("", ids)).toBeUndefined();
    expect(resolveA2ATarget("   ", ids, { writer: "   " })).toBeUndefined();
  });

  it("returns undefined when nothing matches", () => {
    expect(resolveA2ATarget("nobody", ids, { writer: "Story Writer" })).toBeUndefined();
    expect(resolveA2ATarget("writer", [])).toBeUndefined();
  });

  it("treats blank display names as absent", () => {
    expect(resolveA2ATarget("x", ids, { writer: "   ", Reviewer: "" })).toBeUndefined();
  });

  it("ignores names of agents that are not callable", () => {
    expect(resolveA2ATarget("Ghost", ids, { ghost: "Ghost" })).toBeUndefined();
  });

  it("matches by id only when agentNames is omitted", () => {
    expect(resolveA2ATarget("Story Writer", ids)).toBeUndefined();
    expect(resolveA2ATarget("codex-1", ids)).toBe("codex-1");
  });
});
