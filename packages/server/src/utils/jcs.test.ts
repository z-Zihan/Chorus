import { canonicalize } from "@chorus/shared";
import { describe, expect, it } from "vitest";

describe("RFC 8785 JCS", () => {
  it("sorts object keys by UTF-16 code units at every level", () => {
    expect(canonicalize({ z: 1, a: { beta: 2, alpha: 1 }, aa: 3 }))
      .toBe('{"a":{"alpha":1,"beta":2},"aa":3,"z":1}');
    expect(canonicalize({ "\u20ac": 1, "\r": 2, "\ufb33": 3, "1": 4, "😀": 5, "\u0080": 6, "ö": 7 }))
      .toBe('{"\\r":2,"1":4,"\u0080":6,"ö":7,"€":1,"😀":5,"דּ":3}');
  });

  it("uses ECMAScript/JCS number serialization and rejects non-finite numbers", () => {
    expect(canonicalize([333333333.33333329, 1e30, 4.50, 2e-3, 1e-27, -0]))
      .toBe("[333333333.3333333,1e+30,4.5,0.002,1e-27,0]");
    expect(() => canonicalize(Number.NaN)).toThrow(/non-finite/u);
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(/non-finite/u);
  });

  it("applies the required JSON string escaping without extra whitespace", () => {
    expect(canonicalize({ text: "line\nquote\"slash\\tab\t\u0000" }))
      .toBe('{"text":"line\\nquote\\\"slash\\\\tab\\t\\u0000"}');
    // Lone surrogate: JavaScript engine may not flag this via charCodeAt in all cases.
    // The assertValidUnicode check catches unpaired surrogates in string values.
    expect(() => canonicalize(String.fromCharCode(0xd800, 0xd800))).toThrow(/surrogate/u);
  });

  it("differs from insertion-ordered, formatted JSON", () => {
    const value = { b: 2, a: 1 };
    expect(canonicalize(value)).toBe('{"a":1,"b":2}');
    expect(canonicalize(value)).not.toBe(JSON.stringify(value));
    expect(canonicalize(value)).not.toBe(JSON.stringify(value, null, 2));
  });
});
