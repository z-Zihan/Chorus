import { describe, expect, it } from "vitest";
import { resolveRelaySecurityConfig } from "./config.js";

describe("Relay network security config", () => {
  it("defaults to loopback for local development", () => {
    expect(resolveRelaySecurityConfig({})).toEqual({
      host: "127.0.0.1",
      jwtSecret: "chorus-relay-development-secret",
    });
  });

  it("rejects public binding without a strong explicit secret", () => {
    expect(() => resolveRelaySecurityConfig({ RELAY_HOST: "0.0.0.0" })).toThrow(
      "Refusing to expose",
    );
    expect(() =>
      resolveRelaySecurityConfig({
        RELAY_HOST: "0.0.0.0",
        RELAY_JWT_SECRET: "too-short",
      }),
    ).toThrow("at least 32 characters");
  });

  it("allows public binding with an explicit strong secret", () => {
    expect(
      resolveRelaySecurityConfig({
        RELAY_HOST: "0.0.0.0",
        RELAY_JWT_SECRET: "a-secure-relay-secret-with-32-chars",
      }).host,
    ).toBe("0.0.0.0");
  });
});
