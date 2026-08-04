import { execFile } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir, hostname, userInfo } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import type { UserKeyPair } from "./identity/user-keys.js";
import { logger } from "./utils/logger.js";

const execFileAsync = promisify(execFile);
const SERVICE_NAME = "AgentLink";
const USER_KEY_IDENTIFIER = "agentlink:user-key";
const FILE_VERSION = 1;
const FALLBACK_FILE = resolve(
  process.env.AGENTLINK_CREDENTIAL_FILE?.trim() || resolve(homedir(), ".agentlink", "credentials.enc"),
);

type NativeBackend = "macos-keychain" | "windows-credential-manager" | "linux-libsecret";
export type CredentialStorageBackend = "system-keychain" | "file";

interface EncryptedCredentialFile {
  version: number;
  iv: string;
  tag: string;
  ciphertext: string;
}

let selectedBackend: NativeBackend | "file" | undefined;
let fallbackWarningLogged = false;
let fileMutationQueue = Promise.resolve();

export async function setCredential(agentId: string, apiKey: string): Promise<void> {
  validateAgentId(agentId);
  const backend = await resolveBackend();
  if (backend !== "file") {
    try {
      await setNativeCredential(backend, agentId, apiKey);
      return;
    } catch (error) {
      activateFileFallback(backend, error);
    }
  }
  await mutateFileCredentials((credentials) => ({ ...credentials, [agentId]: apiKey }));
}

export async function getCredential(agentId: string): Promise<string | null> {
  validateAgentId(agentId);
  const backend = await resolveBackend();
  if (backend !== "file") {
    try {
      return await getNativeCredential(backend, agentId);
    } catch (error) {
      activateFileFallback(backend, error);
    }
  }
  const credentials = await readFileCredentials();
  return credentials[agentId] ?? null;
}

export async function deleteCredential(agentId: string): Promise<void> {
  validateAgentId(agentId);
  const backend = await resolveBackend();
  if (backend !== "file") {
    try {
      await deleteNativeCredential(backend, agentId);
      return;
    } catch (error) {
      activateFileFallback(backend, error);
    }
  }
  await mutateFileCredentials((credentials) => Object.fromEntries(
    Object.entries(credentials).filter(([storedAgentId]) => storedAgentId !== agentId),
  ));
}

export async function hasCredential(agentId: string): Promise<boolean> {
  return (await getCredential(agentId)) !== null;
}

export async function getUserKey(): Promise<UserKeyPair | null> {
  const serialized = await getCredential(USER_KEY_IDENTIFIER);
  if (serialized === null) return null;

  try {
    const key = JSON.parse(serialized) as Partial<UserKeyPair>;
    if (typeof key.publicKey !== "string" || typeof key.privateKey !== "string") {
      throw new Error("User key is missing public or private key material");
    }
    return { publicKey: key.publicKey, privateKey: key.privateKey };
  } catch (error) {
    throw new Error("Stored User key is invalid", { cause: error });
  }
}

export async function setUserKey(key: UserKeyPair): Promise<void> {
  await setCredential(USER_KEY_IDENTIFIER, JSON.stringify(key));
}

export async function getCredentialStorageBackend(): Promise<CredentialStorageBackend> {
  return (await resolveBackend()) === "file" ? "file" : "system-keychain";
}

async function resolveBackend(): Promise<NativeBackend | "file"> {
  if (selectedBackend) return selectedBackend;

  if (process.platform === "darwin" && await commandExists("security")) {
    selectedBackend = "macos-keychain";
    return selectedBackend;
  }
  if (process.platform === "win32" && await windowsPowerShell()) {
    selectedBackend = "windows-credential-manager";
    return selectedBackend;
  }
  if (process.platform === "linux" && await commandExists("secret-tool")) {
    selectedBackend = "linux-libsecret";
    return selectedBackend;
  }

  activateFileFallback(undefined, new Error("No supported system credential store was found"));
  return "file";
}

function activateFileFallback(backend: NativeBackend | undefined, error: unknown): void {
  selectedBackend = "file";
  if (fallbackWarningLogged) return;
  fallbackWarningLogged = true;
  logger.warn(
    { err: error, backend, path: FALLBACK_FILE },
    "System credential storage is unavailable; using encrypted file fallback",
  );
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync(process.platform === "win32" ? "where.exe" : "which", [command], {
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

async function setNativeCredential(
  backend: NativeBackend,
  agentId: string,
  apiKey: string,
): Promise<void> {
  if (backend === "macos-keychain") {
    await execFileAsync("security", [
      "add-generic-password", "-U", "-s", SERVICE_NAME, "-a", agentId, "-w", apiKey,
    ], { windowsHide: true });
    return;
  }
  if (backend === "linux-libsecret") {
    await execFileWithInput(
      "secret-tool",
      ["store", "--label", `${SERVICE_NAME} (${agentId})`, "service", SERVICE_NAME, "account", agentId],
      apiKey,
    );
    return;
  }
  await runWindowsCredentialCommand("set", agentId, apiKey);
}

async function getNativeCredential(
  backend: NativeBackend,
  agentId: string,
): Promise<string | null> {
  if (backend === "macos-keychain") {
    try {
      const { stdout } = await execFileAsync(
        "security",
        ["find-generic-password", "-s", SERVICE_NAME, "-a", agentId, "-w"],
        { windowsHide: true },
      );
      return stripTrailingNewline(stdout);
    } catch (error) {
      if (isMissingMacCredential(error)) return null;
      throw error;
    }
  }
  if (backend === "linux-libsecret") {
    try {
      const { stdout } = await execFileAsync(
        "secret-tool",
        ["lookup", "service", SERVICE_NAME, "account", agentId],
        { windowsHide: true },
      );
      const credential = stripTrailingNewline(stdout);
      return credential || null;
    } catch (error) {
      if (!commandErrorStderr(error)) return null;
      throw error;
    }
  }
  const value = await runWindowsCredentialCommand("get", agentId);
  return value === "__NOT_FOUND__" ? null : value;
}

async function deleteNativeCredential(backend: NativeBackend, agentId: string): Promise<void> {
  if (backend === "macos-keychain") {
    try {
      await execFileAsync(
        "security",
        ["delete-generic-password", "-s", SERVICE_NAME, "-a", agentId],
        { windowsHide: true },
      );
    } catch (error) {
      if (!isMissingMacCredential(error)) throw error;
    }
    return;
  }
  if (backend === "linux-libsecret") {
    await execFileAsync(
      "secret-tool",
      ["clear", "service", SERVICE_NAME, "account", agentId],
      { windowsHide: true },
    );
    return;
  }
  await runWindowsCredentialCommand("delete", agentId);
}

function execFileWithInput(executable: string, args: string[], input: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = execFile(executable, args, { windowsHide: true }, (error) => {
      if (error) reject(error);
      else resolvePromise();
    });
    child.stdin?.end(input);
  });
}

let cachedPowerShell: string | null | undefined;

async function windowsPowerShell(): Promise<string | null> {
  if (cachedPowerShell !== undefined) return cachedPowerShell;
  for (const executable of ["powershell.exe", "pwsh.exe"]) {
    if (await commandExists(executable)) {
      cachedPowerShell = executable;
      return executable;
    }
  }
  cachedPowerShell = null;
  return null;
}

async function runWindowsCredentialCommand(
  operation: "set" | "get" | "delete",
  agentId: string,
  apiKey?: string,
): Promise<string> {
  const executable = await windowsPowerShell();
  if (!executable) throw new Error("PowerShell is unavailable");
  const target = Buffer.from(`${SERVICE_NAME}:${agentId}`, "utf8").toString("base64");
  const username = Buffer.from(agentId, "utf8").toString("base64");
  const secret = Buffer.from(apiKey ?? "", "utf8").toString("base64");
  const script = windowsCredentialScript(operation, target, username, secret);
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const { stdout } = await execFileAsync(
    executable,
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    { windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  return stripTrailingNewline(stdout);
}

function windowsCredentialScript(
  operation: "set" | "get" | "delete",
  targetBase64: string,
  usernameBase64: string,
  secretBase64: string,
): string {
  const operationCode = operation === "set"
    ? `
$secret = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${secretBase64}'))
$bytes = [Text.Encoding]::Unicode.GetBytes($secret)
$blob = [Runtime.InteropServices.Marshal]::AllocCoTaskMem($bytes.Length)
try {
  [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blob, $bytes.Length)
  $credential = New-Object WinCredential.NativeCredential
  $credential.Type = 1
  $credential.TargetName = $target
  $credential.CredentialBlobSize = $bytes.Length
  $credential.CredentialBlob = $blob
  $credential.Persist = 2
  $credential.UserName = $username
  if (-not [WinCredential.NativeMethods]::CredWrite([ref]$credential, 0)) {
    throw [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
  }
} finally {
  $zeros = New-Object byte[] $bytes.Length
  [Runtime.InteropServices.Marshal]::Copy($zeros, 0, $blob, $zeros.Length)
  [Runtime.InteropServices.Marshal]::FreeCoTaskMem($blob)
}`
    : operation === "get"
      ? `
$pointer = [IntPtr]::Zero
if (-not [WinCredential.NativeMethods]::CredRead($target, 1, 0, [ref]$pointer)) {
  if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 1168) { Write-Output '__NOT_FOUND__'; exit 0 }
  throw [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
}
try {
  $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($pointer, [type][WinCredential.NativeCredential])
  $bytes = New-Object byte[] $credential.CredentialBlobSize
  [Runtime.InteropServices.Marshal]::Copy($credential.CredentialBlob, $bytes, 0, $bytes.Length)
  Write-Output ([Text.Encoding]::Unicode.GetString($bytes))
} finally { [WinCredential.NativeMethods]::CredFree($pointer) }`
      : `
if (-not [WinCredential.NativeMethods]::CredDelete($target, 1, 0)) {
  if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -ne 1168) {
    throw [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
  }
}`;

  return `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace WinCredential {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct NativeCredential {
    public UInt32 Flags; public UInt32 Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist;
    public UInt32 AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  public static class NativeMethods {
    [DllImport("Advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool CredWrite(ref NativeCredential credential, UInt32 flags);
    [DllImport("Advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);
    [DllImport("Advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool CredDelete(string target, UInt32 type, UInt32 flags);
    [DllImport("Advapi32.dll", SetLastError=false)] public static extern void CredFree(IntPtr credential);
  }
}
'@
$target = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${targetBase64}'))
$username = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${usernameBase64}'))
${operationCode}
`;
}

async function readFileCredentials(): Promise<Record<string, string>> {
  try {
    const payload = JSON.parse(await readFile(FALLBACK_FILE, "utf8")) as EncryptedCredentialFile;
    if (payload.version !== FILE_VERSION) throw new Error("Unsupported credential file version");
    const decipher = createDecipheriv("aes-256-gcm", machineKey(), Buffer.from(payload.iv, "base64"));
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext) as Record<string, string>;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return {};
    throw error;
  }
}

async function writeFileCredentials(credentials: Record<string, string>): Promise<void> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", machineKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final(),
  ]);
  const payload: EncryptedCredentialFile = {
    version: FILE_VERSION,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  await mkdir(dirname(FALLBACK_FILE), { recursive: true, mode: 0o700 });
  const temporaryPath = `${FALLBACK_FILE}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, FALLBACK_FILE);
  if (process.platform !== "win32") await access(FALLBACK_FILE, fsConstants.R_OK | fsConstants.W_OK);
}

function mutateFileCredentials(
  mutation: (credentials: Record<string, string>) => Record<string, string>,
): Promise<void> {
  const operation = fileMutationQueue.then(async () => {
    const credentials = await readFileCredentials();
    await writeFileCredentials(mutation(credentials));
  });
  fileMutationQueue = operation.catch(() => undefined);
  return operation;
}

function machineKey(): Buffer {
  return createHash("sha256").update(`${hostname()}:${userInfo().username}`, "utf8").digest();
}

function validateAgentId(agentId: string): void {
  if (!agentId.trim()) throw new Error("Agent ID is required for credential storage");
}

function isMissingMacCredential(error: unknown): boolean {
  const candidate = error as { code?: unknown; stderr?: unknown };
  return candidate.code === 44 || String(candidate.stderr ?? "").includes("could not be found");
}

function commandErrorStderr(error: unknown): string {
  return String((error as { stderr?: unknown }).stderr ?? "").trim();
}

function stripTrailingNewline(value: string): string {
  return value.replace(/[\r\n]+$/u, "");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
