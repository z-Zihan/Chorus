import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseContext } from "./db/index.js";
import { HubRegistry } from "./hub-registry.js";

describe("HubRegistry blocks", () => {
  let directory: string | undefined;
  let database: DatabaseContext | undefined;

  afterEach(() => {
    database?.sqlite.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
    database = undefined;
    directory = undefined;
  });

  it("keeps contact blocks across disconnects and Relay restarts", () => {
    directory = mkdtempSync(join(tmpdir(), "chorus-relay-block-"));
    const dbPath = join(directory, "relay.db");
    database = createDatabase(dbPath);
    const registry = new HubRegistry(database);
    registry.register("hub-a", "key-a", "Hub A");
    registry.register("hub-b", "key-b", "Hub B");
    registry.blockHub("hub-a", "hub-b");

    registry.setOffline("hub-a");
    expect(registry.isBlocked("hub-a", "hub-b")).toBe(true);

    database.sqlite.close();
    database = createDatabase(dbPath);
    const restarted = new HubRegistry(database);
    expect(restarted.isBlocked("hub-b", "hub-a")).toBe(true);
  });
});
