import { describe, expect, it } from "vitest";
import { CLI_DESCRIPTORS } from "../../cli-detector/descriptors.js";
import { defaultCatalog } from "../default-catalog.js";

const CATALOG_KINDS = ["detected-cli", "managed-cli", "api-connector"];
const CATALOG_PLATFORMS = ["darwin", "linux", "win32"];
const INSTALL_METHODS = ["brew", "npm", "winget", "download", "pip"];
const ADAPTER_TYPES = ["cli", "openai"];
const ADAPTER_INPUTS = ["stdin", "argument"];
const ADAPTER_OUTPUTS = ["jsonl", "codex-json", "plain", "json"];

const entries = defaultCatalog.entries;
const detectedEntries = entries.filter((entry) => entry.kind === "detected-cli");
const apiConnectorEntries = entries.filter((entry) => entry.kind === "api-connector");

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isValidHttpUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

describe("defaultCatalog invariants", () => {
  it("uses schemaVersion 1 and ships a non-empty entries list", () => {
    expect(defaultCatalog.schemaVersion).toBe(1);
    expect(entries.length).toBeGreaterThan(0);
  });

  it("uses globally unique, non-empty ids", () => {
    const ids = entries.map((entry) => entry.id);

    for (const id of ids) {
      expect(id.trim(), id).not.toBe("");
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(entries.map((entry) => [entry.id, entry] as const))(
    "%s fills required text fields and publisher metadata",
    (_id, entry) => {
      expect(entry.name.trim(), "name").not.toBe("");
      expect(entry.summary.trim(), "summary").not.toBe("");
      expect(entry.publisher.url.trim(), "publisher.url").not.toBe("");
      expect(typeof entry.publisher.verified).toBe("boolean");
    },
  );

  it.each(entries.map((entry) => [entry.id, entry] as const))(
    "%s declares a valid kind, platforms and capability/permission lists",
    (_id, entry) => {
      expect(CATALOG_KINDS, `kind "${entry.kind}"`).toContain(entry.kind);
      expect(entry.platforms.length).toBeGreaterThan(0);
      for (const platform of entry.platforms) {
        expect(CATALOG_PLATFORMS, `platform "${platform}"`).toContain(platform);
      }
      expect(new Set(entry.platforms).size).toBe(entry.platforms.length);
      expect(entry.capabilities.length).toBeGreaterThan(0);
      expect(new Set(entry.capabilities).size).toBe(entry.capabilities.length);
      expect(entry.permissions.length).toBeGreaterThan(0);
    },
  );

  it.each(entries.map((entry) => [entry.id, entry] as const))(
    "%s links to a valid homepage URL",
    (_id, entry) => {
      expect(isValidHttpUrl(entry.homepage), `homepage "${entry.homepage}"`).toBe(true);
    },
  );

  it.each(
    entries.flatMap((entry) => [
      ...entry.installRecipes.map(
        (recipe) => [`${entry.id} install (${recipe.method})`, recipe] as const,
      ),
      ...entry.uninstallRecipes.map(
        (recipe) => [`${entry.id} uninstall (${recipe.method})`, recipe] as const,
      ),
    ]),
  )("%s is a well-formed recipe", (_label, recipe) => {
    expect(INSTALL_METHODS, `method "${recipe.method}"`).toContain(recipe.method);
    expect(recipe.executable.trim(), "executable").not.toBe("");
    expect(isStringArray(recipe.args), "args").toBe(true);
    expect(typeof recipe.requiresElevation).toBe("boolean");
  });

  it.each(entries.map((entry) => [entry.id, entry] as const))(
    "%s mirrors install and uninstall recipes per method",
    (_id, entry) => {
      for (const install of entry.installRecipes) {
        const uninstall = entry.uninstallRecipes.find((recipe) => recipe.method === install.method);
        expect(uninstall, `${install.method} uninstall recipe`).toBeDefined();
        expect(uninstall?.executable, `${install.method} uninstall executable`).toBe(
          install.executable,
        );
      }
      for (const uninstall of entry.uninstallRecipes) {
        expect(
          entry.installRecipes.some((recipe) => recipe.method === uninstall.method),
          `${uninstall.method} install recipe`,
        ).toBe(true);
      }
    },
  );

  it.each(detectedEntries.map((entry) => [entry.id, entry] as const))(
    "%s (detected-cli) points at a CLI descriptor that shares its id",
    (id, entry) => {
      const descriptorId = entry.descriptorId ?? "";
      expect(descriptorId, "descriptorId").not.toBe("");
      const descriptor = CLI_DESCRIPTORS.find((candidate) => candidate.id === descriptorId);
      expect(descriptor, `CLI_DESCRIPTORS entry for "${descriptorId}"`).toBeDefined();
      expect(descriptorId).toBe(id);
    },
  );

  it.each(detectedEntries.map((entry) => [entry.id, entry] as const))(
    "%s adapter output matches its CLI descriptor's adapter output",
    (id, entry) => {
      const descriptor = CLI_DESCRIPTORS.find(
        (candidate) => candidate.id === (entry.descriptorId ?? ""),
      );
      expect(descriptor, `CLI descriptor for "${id}"`).toBeDefined();
      if (!descriptor) return;

      expect(entry.adapterTemplate.type).toBe("cli");
      expect(entry.adapterTemplate.config.output).toBe(descriptor.adapterTemplate.output);
    },
  );

  it.each(apiConnectorEntries.map((entry) => [entry.id, entry] as const))(
    "%s (api-connector) ships no recipes and an OpenAI adapter template",
    (_id, entry) => {
      expect(entry.installRecipes).toEqual([]);
      expect(entry.uninstallRecipes).toEqual([]);
      expect(entry.adapterTemplate.type).toBe("openai");
      expect(
        isValidHttpUrl(entry.adapterTemplate.config.endpoint),
        `endpoint "${String(entry.adapterTemplate.config.endpoint)}"`,
      ).toBe(true);
      expect(
        isNonEmptyString(entry.adapterTemplate.config.model),
        `model "${String(entry.adapterTemplate.config.model)}"`,
      ).toBe(true);
    },
  );

  it.each(entries.map((entry) => [entry.id, entry] as const))(
    "%s declares a valid adapter template",
    (_id, entry) => {
      expect(ADAPTER_TYPES, `type "${entry.adapterTemplate.type}"`).toContain(
        entry.adapterTemplate.type,
      );
      if (entry.adapterTemplate.type !== "cli") return;

      const { input, output, args } = entry.adapterTemplate.config;
      expect(ADAPTER_INPUTS, `input "${String(input)}"`).toContain(input);
      expect(ADAPTER_OUTPUTS, `output "${String(output)}"`).toContain(output);
      expect(isStringArray(args), "config.args").toBe(true);
    },
  );
});
