const DEVELOPMENT_JWT_SECRET = "chorus-relay-development-secret";

export interface RelaySecurityConfig {
  host: string;
  jwtSecret: string;
}

export function resolveRelaySecurityConfig(
  env: NodeJS.ProcessEnv = process.env,
): RelaySecurityConfig {
  const host = env.RELAY_HOST?.trim() || "127.0.0.1";
  const configuredSecret = env.RELAY_JWT_SECRET?.trim();
  const jwtSecret = configuredSecret || DEVELOPMENT_JWT_SECRET;
  if (!isLoopback(host) && (!configuredSecret || configuredSecret.length < 32)) {
    throw new Error(
      `Refusing to expose the Chorus Relay on ${host} without an explicit ` +
        "RELAY_JWT_SECRET of at least 32 characters.",
    );
  }
  return { host, jwtSecret };
}

function isLoopback(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/u.test(normalized)
  );
}
