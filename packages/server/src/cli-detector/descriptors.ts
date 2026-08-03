export type CliProbeOutput = "text";

export interface CliDescriptor {
  id:
    | "claude-code"
    | "codex"
    | "copilot-cli"
    | "gemini-cli"
    | "aider"
    | "qwen-code"
    | "cursor-cli"
    | "kilo-cli"
    | "opencode"
    | "hermes-agent"
    | "cline"
    | "codebuff"
    | "trae-agent"
    | "iflow-cli";
  displayName: string;
  executable: string;
  executableNames: Partial<Record<NodeJS.Platform, string[]>>;
  knownInstallDirs: Partial<Record<NodeJS.Platform, string[]>>;
  versionProbe: {
    args: string[];
    timeoutMs: number;
    output: CliProbeOutput;
  };
  adapterTemplate: {
    input: "stdin" | "argument";
    output: "jsonl" | "codex-json" | "plain" | "json";
    args: string[];
  };
}

const commonUnixDirs = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];

export const CLI_DESCRIPTORS: CliDescriptor[] = [
  {
    id: "claude-code",
    displayName: "Claude Code",
    executable: "claude",
    executableNames: { darwin: ["claude"], linux: ["claude"], win32: ["claude"] },
    knownInstallDirs: {
      darwin: commonUnixDirs,
      linux: ["/usr/local/bin", "/usr/bin"],
    },
    versionProbe: { args: ["--version"], timeoutMs: 2_000, output: "text" },
    adapterTemplate: {
      input: "argument",
      output: "jsonl",
      args: ["-p", "--output-format", "stream-json", "--verbose", "--no-session-persistence"],
    },
  },
  {
    id: "codex",
    displayName: "Codex",
    executable: "codex",
    executableNames: { darwin: ["codex"], linux: ["codex"], win32: ["codex"] },
    knownInstallDirs: {
      darwin: commonUnixDirs,
      linux: ["/usr/local/bin", "/usr/bin"],
    },
    versionProbe: { args: ["--version"], timeoutMs: 2_000, output: "text" },
    adapterTemplate: { input: "argument", output: "codex-json", args: ["exec", "--json", "--dangerously-bypass-approvals-and-sandbox"] },
  },
  {
    id: "copilot-cli",
    displayName: "GitHub Copilot CLI",
    executable: "copilot",
    executableNames: { darwin: ["copilot"], linux: ["copilot"], win32: ["copilot"] },
    knownInstallDirs: {
      darwin: commonUnixDirs,
      linux: ["/usr/local/bin", "/usr/bin"],
    },
    versionProbe: { args: ["--version"], timeoutMs: 2_000, output: "text" },
    adapterTemplate: { input: "argument", output: "plain", args: ["-p"] },
  },
  {
    id: "gemini-cli",
    displayName: "Gemini CLI",
    executable: "gemini",
    executableNames: { darwin: ["gemini"], linux: ["gemini"], win32: ["gemini"] },
    knownInstallDirs: {
      darwin: commonUnixDirs,
      linux: ["/usr/local/bin", "/usr/bin"],
    },
    versionProbe: { args: ["--version"], timeoutMs: 2_000, output: "text" },
    adapterTemplate: { input: "argument", output: "jsonl", args: ["--json"] },
  },
  {
    id: "aider",
    displayName: "Aider",
    executable: "aider",
    executableNames: { darwin: ["aider"], linux: ["aider"], win32: ["aider"] },
    knownInstallDirs: {
      darwin: commonUnixDirs,
      linux: ["/usr/local/bin", "/usr/bin"],
    },
    versionProbe: { args: ["--version"], timeoutMs: 2_000, output: "text" },
    adapterTemplate: {
      input: "stdin",
      output: "plain",
      args: ["--no-auto-commits", "--stream"],
    },
  },
  {
    id: "qwen-code",
    displayName: "Qwen Code",
    executable: "qwen",
    executableNames: { darwin: ["qwen"], linux: ["qwen"], win32: ["qwen"] },
    knownInstallDirs: {
      darwin: commonUnixDirs,
      linux: ["/usr/local/bin", "/usr/bin"],
    },
    versionProbe: { args: ["--version"], timeoutMs: 2_000, output: "text" },
    adapterTemplate: { input: "argument", output: "plain", args: ["--no-stream"] },
  },
  {
    id: "cursor-cli",
    displayName: "Cursor CLI",
    executable: "cursor",
    executableNames: { darwin: ["cursor"], linux: ["cursor"], win32: ["cursor"] },
    knownInstallDirs: {
      darwin: commonUnixDirs,
      linux: ["/usr/local/bin", "/usr/bin"],
    },
    versionProbe: { args: ["--version"], timeoutMs: 2_000, output: "text" },
    adapterTemplate: { input: "argument", output: "jsonl", args: ["--json"] },
  },
  {
    id: "kilo-cli",
    displayName: "Kilo CLI",
    executable: "kilo",
    executableNames: { darwin: ["kilo"], linux: ["kilo"], win32: ["kilo"] },
    knownInstallDirs: {
      darwin: commonUnixDirs,
      linux: ["/usr/local/bin", "/usr/bin"],
    },
    versionProbe: { args: ["--version"], timeoutMs: 2_000, output: "text" },
    adapterTemplate: { input: "argument", output: "jsonl", args: ["--json"] },
  },
  {
    id: "opencode",
    displayName: "OpenCode",
    executable: "opencode",
    executableNames: { darwin: ["opencode"], linux: ["opencode"], win32: ["opencode"] },
    knownInstallDirs: {
      darwin: commonUnixDirs,
      linux: ["/usr/local/bin", "/usr/bin"],
    },
    versionProbe: { args: ["--version"], timeoutMs: 2_000, output: "text" },
    adapterTemplate: { input: "argument", output: "plain", args: ["run"] },
  },
  {
    id: "hermes-agent",
    displayName: "Hermes Agent",
    executable: "hermes",
    executableNames: { darwin: ["hermes"], linux: ["hermes"], win32: ["hermes"] },
    knownInstallDirs: {
      darwin: commonUnixDirs,
      linux: ["/usr/local/bin", "/usr/bin"],
    },
    versionProbe: { args: ["--version"], timeoutMs: 2_000, output: "text" },
    adapterTemplate: { input: "argument", output: "jsonl", args: ["--json"] },
  },
  {
    id: "cline",
    displayName: "Cline",
    executable: "cline",
    executableNames: { darwin: ["cline"], linux: ["cline"], win32: ["cline"] },
    knownInstallDirs: {
      darwin: commonUnixDirs,
      linux: ["/usr/local/bin", "/usr/bin"],
    },
    versionProbe: { args: ["--version"], timeoutMs: 2_000, output: "text" },
    adapterTemplate: { input: "argument", output: "jsonl", args: ["--json"] },
  },
  {
    id: "codebuff",
    displayName: "Codebuff",
    executable: "codebuff",
    executableNames: { darwin: ["codebuff"], linux: ["codebuff"], win32: ["codebuff"] },
    knownInstallDirs: {
      darwin: commonUnixDirs,
      linux: ["/usr/local/bin", "/usr/bin"],
    },
    versionProbe: { args: ["--version"], timeoutMs: 2_000, output: "text" },
    adapterTemplate: { input: "argument", output: "plain", args: [] },
  },
  {
    id: "trae-agent",
    displayName: "Trae Agent",
    executable: "trae",
    executableNames: { darwin: ["trae"], linux: ["trae"], win32: ["trae"] },
    knownInstallDirs: {
      darwin: commonUnixDirs,
      linux: ["/usr/local/bin", "/usr/bin"],
    },
    versionProbe: { args: ["--version"], timeoutMs: 2_000, output: "text" },
    adapterTemplate: { input: "argument", output: "plain", args: ["run"] },
  },
  {
    id: "iflow-cli",
    displayName: "iFlow CLI",
    executable: "iflow",
    executableNames: { darwin: ["iflow"], linux: ["iflow"], win32: ["iflow"] },
    knownInstallDirs: {
      darwin: commonUnixDirs,
      linux: ["/usr/local/bin", "/usr/bin"],
    },
    versionProbe: { args: ["--version"], timeoutMs: 2_000, output: "text" },
    adapterTemplate: { input: "argument", output: "plain", args: [] },
  },
];

export function getCliDescriptor(id: string): CliDescriptor | undefined {
  return CLI_DESCRIPTORS.find((descriptor) => descriptor.id === id);
}
