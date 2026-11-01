import { canonicalize } from "@chorus/shared";
import { describe, expect, it } from "vitest";

describe("RFC 8785 JCS", () => {
  it("sorts object keys by UTF-16 code units at every level", () => {
    expect(canonicalize({ z: 1, a: { beta: 2, alpha: 1 }, aa: 3 })).toBe(
      '{"a":{"alpha":1,"beta":2},"aa":3,"z":1}',
    );
    expect(
      canonicalize({ "\u20ac": 1, "\r": 2, "\ufb33": 3, "1": 4, "😀": 5, "\u0080": 6, ö: 7 }),
    ).toBe('{"\\r":2,"1":4,"\u0080":6,"ö":7,"€":1,"😀":5,"דּ":3}');
  });

  it("uses ECMAScript/JCS number serialization and rejects non-finite numbers", () => {
    expect(canonicalize([333333333.33333329, 1e30, 4.5, 2e-3, 1e-27, -0])).toBe(
      "[333333333.3333333,1e+30,4.5,0.002,1e-27,0]",
    );
    expect(() => canonicalize(Number.NaN)).toThrow(/non-finite/u);
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(/non-finite/u);
  });

  it("applies the required JSON string escaping without extra whitespace", () => {
    expect(canonicalize({ text: 'line\nquote"slash\\tab\t\u0000' })).toBe(
      '{"text":"line\\nquote\\\"slash\\\\tab\\t\\u0000"}',
    );
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

describe("RFC 8785 JCS edge cases", () => {
  it("serializes primitives and empty containers directly", () => {
    expect(canonicalize(0)).toBe("0");
    expect(canonicalize(false)).toBe("false");
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize("x")).toBe('"x"');
    expect(canonicalize([])).toBe("[]");
    expect(canonicalize({})).toBe("{}");
  });

  it("orders keys by UTF-16 code units, not by code points", () => {
    // U+FFFB > U+1F600 as code points, but the emoji's leading surrogate 0xD83D < 0xFFFB.
    expect(canonicalize({ "￻": 1, "😀": 2 })).toBe('{"😀":2,"￻":1}');
  });

  it("rejects sparse arrays", () => {
    expect(() => canonicalize([1, , 3])).toThrow(/sparse/u);
    expect(() => canonicalize(new Array(2))).toThrow(/sparse/u);
  });

  it("rejects cyclic values but allows shared non-cyclic references", () => {
    const self: Record<string, unknown> = {};
    self.self = self;
    expect(() => canonicalize(self)).toThrow(/cyclic/u);

    const parent: Record<string, unknown> = {};
    parent.children = [{ parent }];
    expect(() => canonicalize(parent)).toThrow(/cyclic/u);

    const shared = { v: 1 };
    expect(canonicalize({ a: shared, b: [shared] })).toBe('{"a":{"v":1},"b":[{"v":1}]}');
  });

  it("omits undefined object properties but rejects undefined elsewhere", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalize({ nested: { gone: undefined } })).toBe('{"nested":{}}');
    // Unlike JSON.stringify, undefined is not coerced to null in arrays or at the top level.
    expect(() => canonicalize([undefined])).toThrow(/undefined/u);
    expect(() => canonicalize(undefined)).toThrow(/undefined/u);
  });

  it("rejects values outside the JSON data model", () => {
    expect(() => canonicalize(1n)).toThrow(/bigint/u);
    expect(() => canonicalize({ fn: () => undefined })).toThrow(/function/u);
    expect(() => canonicalize([Symbol("s")])).toThrow(/symbol/u);
  });

  it("rejects lone surrogates in object keys", () => {
    expect(() => canonicalize({ [String.fromCharCode(0xdc00)]: 1 })).toThrow(/surrogate/u);
    expect(() => canonicalize({ [`${String.fromCharCode(0xd800)}a`]: 1 })).toThrow(/surrogate/u);
  });

  it("rejects a lone high surrogate at the end of a value or key", () => {
    expect(() => canonicalize("\ud800")).toThrow(/surrogate/u);
    expect(() => canonicalize({ [String.fromCharCode(0xd800)]: 1 })).toThrow(/surrogate/u);
    expect(() => canonicalize("\udc00")).toThrow(/surrogate/u);
    // Well-formed pairs are emitted as the literal astral character, not escaped.
    expect(canonicalize("\ud800\udc00")).toBe('"\u{10000}"');
  });

  it("canonicalizes nested containers of mixed types", () => {
    expect(
      canonicalize([
        { z: "s", a: 1.5, m: [true, null, [false, -2]] },
        { y: { b: null, a: "" } },
        [],
      ]),
    ).toBe('[{"a":1.5,"m":[true,null,[false,-2]],"z":"s"},{"y":{"a":"","b":null}},[]]');
  });

  it("does not mutate its input", () => {
    const value = { b: [3, { d: 1, c: 2 }], a: undefined, e: "x" };
    const before = JSON.stringify(value);
    const keysBefore = Object.keys(value);

    expect(canonicalize(value)).toBe('{"b":[3,{"c":2,"d":1}],"e":"x"}');
    expect(JSON.stringify(value)).toBe(before);
    expect(Object.keys(value)).toEqual(keysBefore);
    expect(Object.hasOwn(value, "a")).toBe(true);
  });
});
