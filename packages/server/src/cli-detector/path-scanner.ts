import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { CliDetectionSource } from "@agentlink/shared";
import { CLI_DESCRIPTORS, type CliDescriptor } from "./descriptors.js";
import { appendLimited, normalizeForComparison, throwIfAborted } from "./utils.js";

const LOGIN_SHELL_TIMEOUT_MS = 2_000;

export interface ExecutableCandidate {
  descriptor: CliDescriptor;
  executablePath: string;
  resolvedPath: string;
  source: CliDetectionSource;
}

export interface SearchDirectory {
  path: string;
  source: Exclude<CliDetectionSource, "user_selected">;
}

export async function scanPath(signal?: AbortSignal): Promise<ExecutableCandidate[]> {
  throwIfAborted(signal);
  const searchDirectories = await collectSearchDirectories(signal);
  const candidates: ExecutableCandidate[] = [];
  const resolvedPaths = new Set<string>();

  for (const descriptor of CLI_DESCRIPTORS) {
    const names = descriptor.executableNames[process.platform] ?? [descriptor.executable];
    for (const directory of searchDirectories) {
      for (const name of names) {
        for (const filename of executableFilenames(name)) {
          throwIfAborted(signal);
          const executablePath = join(directory.path, filename);
          try {
            await access(
              executablePath,
              process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK,
            );
            const resolvedPath = await realpath(executablePath);
            const dedupeKey = normalizeForComparison(resolvedPath);
            if (resolvedPaths.has(dedupeKey)) continue;
            resolvedPaths.add(dedupeKey);
            candidates.push({ descriptor, executablePath, resolvedPath, source: directory.source });
          } catch {
            // Missing and inaccessible candidates are expected during a scan.
          }
        }
      }
    }
  }

  return candidates;
}

export async function collectSearchDirectories(signal?: AbortSignal): Promise<SearchDirectory[]> {
  const result: SearchDirectory[] = [];
  addPathEntries(result, process.env.PATH, "process_path");

  const loginPath = await readLoginShellPath(signal);
  addPathEntries(result, loginPath, "login_shell");

  const userHome = homedir();
  const known = new Set<string>();
  for (const descriptor of CLI_DESCRIPTORS) {
    for (const directory of descriptor.knownInstallDirs[process.platform] ?? []) known.add(directory);
  }
  if (process.platform === "darwin") {
    known.add("/opt/homebrew/bin");
    known.add("/usr/local/bin");
    known.add(join(userHome, ".local", "bin"));
  } else if (process.platform === "linux") {
    known.add(join(userHome, ".local", "bin"));
    known.add(join(userHome, ".local", "share", "pnpm"));
  } else if (process.platform === "win32") {
    if (process.env.LOCALAPPDATA) known.add(join(process.env.LOCALAPPDATA, "Programs"));
    if (process.env.APPDATA) known.add(join(process.env.APPDATA, "npm"));
  }
  for (const path of known) result.push({ path, source: "known_dir" });

  const deduplicated = new Map<string, SearchDirectory>();
  for (const directory of result) {
    if (!directory.path.trim()) continue;
    const key = normalizeForComparison(directory.path);
    if (!deduplicated.has(key)) deduplicated.set(key, directory);
  }
  return [...deduplicated.values()];
}

export function addPathEntries(
  target: SearchDirectory[],
  value: string | undefined,
  source: SearchDirectory["source"],
): void {
  for (const path of value?.split(delimiter) ?? []) {
    if (path.trim()) target.push({ path: path.trim(), source });
  }
}

export async function readLoginShellPath(signal?: AbortSignal): Promise<string | undefined> {
  if (process.platform === "win32") return undefined;
  const shell = process.env.SHELL?.trim();
  if (!shell) return undefined;

  return new Promise<string | undefined>((resolve) => {
    let output: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let settled = false;
    const child = spawn(shell, ["-l", "-c", "printf '%s' \"$PATH\""], {
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortHandler);
      resolve(output.toString("utf8").trim() || undefined);
    };
    const abortHandler = () => {
      child.kill();
      finish();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish();
    }, LOGIN_SHELL_TIMEOUT_MS);
    signal?.addEventListener("abort", abortHandler, { once: true });
    child.stdout?.on("data", (chunk: Buffer) => {
      output = appendLimited(output, chunk);
    });
    child.once("error", finish);
    child.once("close", finish);
  });
}

export function executableFilenames(name: string): string[] {
  if (process.platform !== "win32") return [name];
  if (/\.[^.]+$/u.test(name)) return [name];
  const extensions = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT")
    .split(";")
    .map((extension) => extension.trim().toLowerCase())
    .filter((extension) => [".exe", ".cmd", ".bat"].includes(extension));
  return [...new Set(extensions.length ? extensions : [".exe", ".cmd", ".bat"])]
    .map((extension) => `${name}${extension}`);
}
