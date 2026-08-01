import { delimiter } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addPathEntries,
  collectSearchDirectories,
  executableFilenames,
  type SearchDirectory,
} from "../path-scanner.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("path scanner helpers", () => {
  it("splits PATH entries using the platform delimiter", () => {
    const entries: SearchDirectory[] = [];

    addPathEntries(entries, [`/first`, ` /second `, ""].join(delimiter), "process_path");

    expect(entries).toEqual([
      { path: "/first", source: "process_path" },
      { path: "/second", source: "process_path" },
    ]);
  });

  it("adds supported PATHEXT extensions on Windows", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    vi.stubEnv("PATHEXT", ".EXE;.CMD;.BAT;.COM;.EXE");

    expect(executableFilenames("codex")).toEqual(["codex.exe", "codex.cmd", "codex.bat"]);
    expect(executableFilenames("codex.exe")).toEqual(["codex.exe"]);
  });

  it("deduplicates search directories", async () => {
    vi.stubEnv("SHELL", "");
    vi.stubEnv("PATH", [`/duplicate`, `/duplicate`, `/unique`].join(delimiter));

    const directories = await collectSearchDirectories();
    const paths = directories.map((directory) => directory.path);

    expect(paths.filter((path) => path === "/duplicate")).toHaveLength(1);
    expect(paths).toContain("/unique");
  });
});
