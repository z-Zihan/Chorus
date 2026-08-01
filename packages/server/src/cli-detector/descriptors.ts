export type CliProbeOutput = "text";

export interface CliDescriptor {
  id: "claude-code" | "codex" | "copilot-cli";
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
    adapterTemplate: { input: "argument", output: "codex-json", args: ["exec", "--json"] },
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
];

export function getCliDescriptor(id: string): CliDescriptor | undefined {
  return CLI_DESCRIPTORS.find((descriptor) => descriptor.id === id);
}
