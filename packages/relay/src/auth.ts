import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");

export function createHubToken(hubId: string, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ sub: hubId, iat: Math.floor(Date.now() / 1_000) }))
    .toString("base64url");
  const unsigned = `${TOKEN_HEADER}.${payload}`;
  const signature = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

export function verifyHubToken(token: string, hubId: string, secret: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return false;
  const unsigned = `${parts[0]}.${parts[1]}`;
  const expected = createHmac("sha256", secret).update(unsigned).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(parts[2], "base64url");
  } catch {
    return false;
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { sub?: unknown };
    return payload.sub === hubId;
  } catch {
    return false;
  }
}
