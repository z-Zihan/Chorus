export type CatalogKind = "detected-cli" | "managed-cli" | "api-connector";
export type CatalogPlatform = "darwin" | "linux" | "win32";

export interface InstallRecipe {
  method: "brew" | "npm" | "winget" | "download";
  executable: string;
  args: string[];
  requiresElevation: boolean;
}

export interface CatalogEntry {
  id: string;
  name: string;
  summary: string;
  publisher: {
    name: string;
    url: string;
    verified: boolean;
  };
  kind: CatalogKind;
  platforms: CatalogPlatform[];
  capabilities: string[];
  permissions: string[];
  homepage: string;
  license: string;
  descriptorId?: string;
  installRecipes: InstallRecipe[];
  uninstallRecipes: InstallRecipe[];
  adapterTemplate: {
    type: "cli" | "openai";
    config: Record<string, unknown>;
  };
}

export interface CatalogFile {
  schemaVersion: number;
  entries: CatalogEntry[];
}

export interface CatalogEntryWithStatus extends CatalogEntry {
  installed: boolean;
  agentId?: string;
  disabled?: boolean;
}
