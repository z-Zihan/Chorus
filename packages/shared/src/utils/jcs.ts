/**
 * Serialize a JSON value using RFC 8785 JSON Canonicalization Scheme (JCS).
 *
 * Object property names are sorted by their UTF-16 code units. Number and
 * string rendering intentionally delegates to ECMAScript's JSON serializer,
 * as required by RFC 8785, after rejecting values outside the I-JSON domain.
 */
export function canonicalize(value: unknown): string {
  const ancestors = new Set<object>();

  const serialize = (current: unknown): string => {
    if (current === null) return "null";

    switch (typeof current) {
      case "boolean":
        return current ? "true" : "false";
      case "number":
        if (!Number.isFinite(current)) {
          throw new TypeError("JCS cannot serialize non-finite numbers");
        }
        return JSON.stringify(current);
      case "string":
        assertValidUnicode(current);
        return JSON.stringify(current);
      case "object":
        break;
      default:
        throw new TypeError(`JCS cannot serialize values of type ${typeof current}`);
    }

    if (ancestors.has(current)) throw new TypeError("JCS cannot serialize cyclic values");
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        for (let index = 0; index < current.length; index += 1) {
          if (!Object.hasOwn(current, index)) {
            throw new TypeError("JCS cannot serialize sparse arrays");
          }
        }
        return `[${current.map((item) => serialize(item)).join(",")}]`;
      }

      const record = current as Record<string, unknown>;
      // JSON object serialization omits properties whose value is undefined.
      // This also lets callers canonicalize ordinary typed objects containing
      // optional fields before they enter the JSON/I-JSON data model.
      const keys = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort(compareUtf16);
      return `{${keys.map((key) => {
        assertValidUnicode(key);
        return `${JSON.stringify(key)}:${serialize(record[key])}`;
      }).join(",")}}`;
    } finally {
      ancestors.delete(current);
    }
  };

  return serialize(value);
}

function compareUtf16(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function assertValidUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (trailing < 0xdc00 || trailing > 0xdfff) {
        throw new TypeError("JCS cannot serialize lone Unicode surrogates");
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeError("JCS cannot serialize lone Unicode surrogates");
    }
  }
}
