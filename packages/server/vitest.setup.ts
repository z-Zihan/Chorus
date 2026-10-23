// credential-store.ts reads CHORUS_CREDENTIAL_FILE into a module-level const
// (FALLBACK_FILE / SALT_FILE) at import time, so this must run before any test
// file imports credential-store.
//
// Route tests that build a real app (e.g. skill-contract.test.ts,
// standards.test.ts via test-app.ts) never mock credential-store. On CI
// Linux runners there is no native keyring, so getOrCreateLocalUser falls
// through to the file backend and reads/writes the real
// ~/.chorus/credentials.enc + .salt pair. Vitest runs multiple worker
// processes concurrently, and those workers raced on that shared pair: each
// worker's machineSalt() hit ENOENT on first access, generated its own salt,
// and clobbered the others' SALT_FILE, while each cached a different salt
// value in memory. Decrypting data written under a different salt fails
// AES-256-GCM tag verification ("Unsupported state or unable to authenticate
// data"). Pointing each worker at its own temp file removes the race.
//
// VITEST_POOL_ID distinguishes workers within a single `vitest run`. No
// directory needs to be pre-created: writeFileCredentials/machineSalt both
// mkdir -p their target directory before writing.
import { tmpdir } from "node:os";
import { join } from "node:path";

const workerId = process.env.VITEST_POOL_ID ?? "0";
const isolatedDir = join(tmpdir(), `chorus-server-test-credentials-${process.pid}-${workerId}`);
process.env.CHORUS_CREDENTIAL_FILE = join(isolatedDir, "credentials.enc");
