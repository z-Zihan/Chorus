import { createRequire } from "node:module";
import { chmod, copyFile, cp, mkdir, readFile, rm } from "node:fs/promises";
import { arch, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const hostTargets = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "win32-arm64": "aarch64-pc-windows-msvc",
  "win32-x64": "x86_64-pc-windows-msvc",
};

const hostKey = `${platform()}-${arch()}`;
const hostTarget = hostTargets[hostKey];
if (!hostTarget) throw new Error(`Unsupported sidecar build host: ${hostKey}`);

const target =
  process.env.TAURI_ENV_TARGET_TRIPLE?.trim() ||
  process.env.CARGO_BUILD_TARGET?.trim() ||
  hostTarget;
const configuredBinary = process.env.CHORUS_NODE_BINARY?.trim();
if (target !== hostTarget && !configuredBinary) {
  throw new Error(`Cross-building ${target} requires CHORUS_NODE_BINARY for that target`);
}

const source = resolve(configuredBinary || process.execPath);
const extension = target.includes("windows") ? ".exe" : "";
const directory = resolve(workspaceRoot, "src-tauri/binaries");
const destination = resolve(directory, `chorus-node-${target}${extension}`);

await mkdir(directory, { recursive: true });
await copyFile(source, destination);
if (!extension) await chmod(destination, 0o755);
console.log(`Prepared bundled Node sidecar: ${destination}`);

const configuredSqliteDirectory = process.env.CHORUS_BETTER_SQLITE3_DIR?.trim();
if (target !== hostTarget && !configuredSqliteDirectory) {
  throw new Error(`Cross-building ${target} requires CHORUS_BETTER_SQLITE3_DIR for that target`);
}

const findPackageDirectory = async (
  packageName,
  searchPaths = [join(workspaceRoot, "packages/server")],
) => {
  const entry = require.resolve(packageName, {
    paths: searchPaths,
  });
  let current = dirname(entry);
  while (current !== dirname(current)) {
    try {
      const raw = await readFile(join(current, "package.json"), "utf8");
      const manifest = JSON.parse(raw);
      if (manifest.name === packageName) return current;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    current = dirname(current);
  }
  throw new Error(`Could not locate package directory for ${packageName}`);
};

const runtimeRoot = resolve(workspaceRoot, "src-tauri/runtime/node_modules");
await rm(runtimeRoot, { recursive: true, force: true });
await mkdir(runtimeRoot, { recursive: true });

const sqliteDirectory = configuredSqliteDirectory
  ? resolve(configuredSqliteDirectory)
  : await findPackageDirectory("better-sqlite3");

await cp(sqliteDirectory, join(runtimeRoot, "better-sqlite3"), {
  recursive: true,
  dereference: true,
});
const bindingsDirectory = await findPackageDirectory("bindings", [sqliteDirectory]);
const fileUriDirectory = await findPackageDirectory("file-uri-to-path", [bindingsDirectory]);
for (const [packageName, packageDirectory] of [
  ["bindings", bindingsDirectory],
  ["file-uri-to-path", fileUriDirectory],
  ["jiti", await findPackageDirectory("jiti")],
]) {
  await cp(packageDirectory, join(runtimeRoot, packageName), {
    recursive: true,
    dereference: true,
  });
}

console.log(`Prepared native server runtime: ${runtimeRoot}`);
