import { isTauri } from "@/services/env";

export type OpenTerminalResult = "opened" | "instructions";

function terminalCommandName(): string {
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes("windows")) return "open-terminal-windows";
  if (userAgent.includes("macintosh") || userAgent.includes("mac os")) {
    return "open-terminal-macos";
  }
  return "open-terminal-linux";
}

/**
 * Opens the native terminal in Tauri. Browser builds keep the login command
 * visible in the onboarding UI and return `instructions` instead.
 */
export async function openTerminal(): Promise<OpenTerminalResult> {
  if (!isTauri()) return "instructions";

  const { Command } = await import("@tauri-apps/plugin-shell");
  await Command.create(terminalCommandName()).spawn();
  return "opened";
}
