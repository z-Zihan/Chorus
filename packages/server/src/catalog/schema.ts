import type { AgentType } from "@agentlink/shared";

export type CatalogKind = "detected-cli" | "managed-cli" | "api-connector";
export type CatalogPlatform = "darwin" | "linux" | "win32";
export type InstallMethod = "brew" | "npm" | "winget" | "download" | "pip";

export interface InstallRecipe {
  method: InstallMethod;
  executable: string;
  args: string[];
  requiresElevation: boolean;
}

export interface CatalogEntry {
  id: string;
  name: string;
  summary: string;
  publisher: { name: string; url: string; verified: boolean };
  kind: CatalogKind;
  platforms: CatalogPlatform[];
  capabilities: string[];
  permissions: string[];
  homepage: string;
  license?: string;
  descriptorId?: string;
  installRecipes: InstallRecipe[];
  uninstallRecipes: InstallRecipe[];
  adapterTemplate: { type: AgentType; config: Record<string, unknown> };
}

export interface CatalogFile {
  schemaVersion: number;
  entries: CatalogEntry[];
}

export interface CatalogEntryWithStatus extends CatalogEntry {
  installed: boolean;
  detected?: boolean;
  agentId?: string;
  disabled?: boolean;
}
