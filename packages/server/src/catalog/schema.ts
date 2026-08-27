import type {
  CatalogEntry,
  CatalogEntryWithStatus,
  CatalogKind,
  CatalogPlatform,
  InstallMethod,
  InstallRecipe,
} from "@chorus/shared";

export type {
  CatalogEntry,
  CatalogEntryWithStatus,
  CatalogKind,
  CatalogPlatform,
  InstallMethod,
  InstallRecipe,
};

export interface CatalogFile {
  schemaVersion: number;
  entries: CatalogEntry[];
}
