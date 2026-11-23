import type { CliDetection, InstallationStatus } from "@chorus/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: {
    getCatalog: vi.fn(),
    installCatalogEntry: vi.fn(),
    getInstallation: vi.fn(),
    cancelInstallation: vi.fn(),
    getCliDetections: vi.fn(),
    adoptDetection: vi.fn(),
    getAgent: vi.fn(),
  },
  fetchAgents: vi.fn(),
  selectAgent: vi.fn(),
  addToast: vi.fn(),
}));

vi.mock("@/services/api", () => ({ api: mocks.api }));
vi.mock("@/store/agentStore", () => ({
  useAgentStore: {
    getState: () => ({ fetchAgents: mocks.fetchAgents, selectAgent: mocks.selectAgent }),
  },
}));
vi.mock("@/store/uiStore", () => ({
  useUIStore: { getState: () => ({ addToast: mocks.addToast }) },
}));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/utils/logger", () => ({ logger: { error: vi.fn() } }));

import { type CatalogEntry, useCatalogStore } from "./catalogStore";

const { api, fetchAgents, selectAgent, addToast } = mocks;
const initialState = useCatalogStore.getState();

function entry(id: string, overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return { id, installed: false, ...overrides } as CatalogEntry;
}

function installation(overrides: Partial<InstallationStatus> = {}): InstallationStatus {
  return {
    id: "inst-1",
    entryId: "entry-1",
    stage: "installing",
    progress: 0,
    startedAt: 1,
    updatedAt: 1,
    ...overrides,
  } as InstallationStatus;
}

beforeEach(() => {
  vi.useFakeTimers();
  for (const fn of Object.values(api)) fn.mockReset();
  fetchAgents.mockReset().mockResolvedValue(undefined);
  selectAgent.mockReset();
  addToast.mockReset();
  api.getCatalog.mockResolvedValue([]);
  useCatalogStore.setState(initialState, true);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("useCatalogStore.fetchCatalog", () => {
  it("loads entries and refreshes the selected entry by id", async () => {
    useCatalogStore.setState({ selectedEntry: entry("a") });
    api.getCatalog.mockResolvedValue([entry("a", { installed: true }), entry("b")]);

    await useCatalogStore.getState().fetchCatalog();

    expect(api.getCatalog).toHaveBeenCalledWith(true);
    const state = useCatalogStore.getState();
    expect(state.entries.map((e) => e.id)).toEqual(["a", "b"]);
    expect(state.selectedEntry).toMatchObject({ id: "a", installed: true });
    expect(state).toMatchObject({ isLoading: false, loadError: false });
  });

  it("drops the selection when the selected entry disappears", async () => {
    useCatalogStore.setState({ selectedEntry: entry("gone") });
    api.getCatalog.mockResolvedValue([entry("a")]);
    await useCatalogStore.getState().fetchCatalog();
    expect(useCatalogStore.getState().selectedEntry).toBeNull();
  });

  it("flags loadError when the request fails", async () => {
    api.getCatalog.mockRejectedValue(new Error("offline"));
    const pending = useCatalogStore.getState().fetchCatalog();
    expect(useCatalogStore.getState()).toMatchObject({ isLoading: true, loadError: false });
    await pending;
    expect(useCatalogStore.getState()).toMatchObject({ isLoading: false, loadError: true });
  });
});

describe("useCatalogStore.selectEntry", () => {
  it("sets the selection and resets installation progress", () => {
    useCatalogStore.setState({ installation: installation() });
    useCatalogStore.getState().selectEntry(entry("a"));
    expect(useCatalogStore.getState()).toMatchObject({
      selectedEntry: { id: "a" },
      installation: null,
    });
  });
});

describe("useCatalogStore.installAgent", () => {
  it("refreshes and selects the agent when installation finishes immediately", async () => {
    api.installCatalogEntry.mockResolvedValue(installation({ stage: "done", agentId: "agent-9" }));

    await useCatalogStore.getState().installAgent("entry-1");

    expect(api.installCatalogEntry).toHaveBeenCalledWith("entry-1", {});
    expect(api.getCatalog).toHaveBeenCalledTimes(1);
    expect(fetchAgents).toHaveBeenCalledTimes(1);
    expect(selectAgent).toHaveBeenCalledWith("agent-9");
    expect(addToast).toHaveBeenCalledWith("catalog.success", "success");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("polls until the installation is done", async () => {
    api.installCatalogEntry.mockResolvedValue(installation({ stage: "installing" }));
    api.getInstallation
      .mockResolvedValueOnce(installation({ stage: "installing", progress: 50 }))
      .mockResolvedValueOnce(installation({ stage: "done", progress: 100, agentId: "agent-9" }));

    await useCatalogStore.getState().installAgent("entry-1", { apiKey: "k" });
    expect(api.installCatalogEntry).toHaveBeenCalledWith("entry-1", { apiKey: "k" });

    await vi.advanceTimersByTimeAsync(299);
    expect(api.getInstallation).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.getInstallation).toHaveBeenCalledWith("inst-1");
    expect(useCatalogStore.getState().installation).toMatchObject({ progress: 50 });

    await vi.advanceTimersByTimeAsync(499);
    expect(api.getInstallation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.getInstallation).toHaveBeenCalledTimes(2);

    expect(useCatalogStore.getState().installation).toMatchObject({ stage: "done" });
    expect(fetchAgents).toHaveBeenCalledTimes(1);
    expect(selectAgent).toHaveBeenCalledWith("agent-9");
    expect(addToast).toHaveBeenCalledWith("catalog.success", "success");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops polling and toasts when the installation errors", async () => {
    api.installCatalogEntry.mockResolvedValue(installation());
    api.getInstallation.mockResolvedValue(installation({ stage: "error", error: "nope" }));

    await useCatalogStore.getState().installAgent("entry-1");
    await vi.advanceTimersByTimeAsync(300);

    expect(useCatalogStore.getState().installation).toMatchObject({ stage: "error" });
    expect(addToast).toHaveBeenCalledWith("catalog.failed", "error");
    expect(fetchAgents).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops polling once the tracked installation is replaced", async () => {
    api.installCatalogEntry.mockResolvedValue(installation());

    await useCatalogStore.getState().installAgent("entry-1");
    useCatalogStore.getState().selectEntry(entry("other"));
    await vi.advanceTimersByTimeAsync(300);

    expect(api.getInstallation).not.toHaveBeenCalled();
  });

  it("cancels a previous poll when a new install starts", async () => {
    api.installCatalogEntry
      .mockResolvedValueOnce(installation({ id: "inst-1" }))
      .mockResolvedValueOnce(installation({ id: "inst-2" }));
    api.getInstallation.mockResolvedValue(installation({ id: "inst-2", stage: "error" }));

    await useCatalogStore.getState().installAgent("entry-1");
    await useCatalogStore.getState().installAgent("entry-2");
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(300);

    expect(api.getInstallation).toHaveBeenCalledTimes(1);
    expect(api.getInstallation).toHaveBeenCalledWith("inst-2");
  });

  it("clears installation state when the install request fails", async () => {
    useCatalogStore.setState({ installation: installation({ id: "old" }) });
    api.installCatalogEntry.mockRejectedValue(new Error("boom"));

    await useCatalogStore.getState().installAgent("entry-1");

    expect(useCatalogStore.getState().installation).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("useCatalogStore.cancelInstall", () => {
  it.each([
    ["no installation", null],
    ["a finished installation", installation({ stage: "done" })],
    ["a failed installation", installation({ stage: "error" })],
  ])("is a no-op for %s", async (_label, current) => {
    useCatalogStore.setState({ installation: current });
    await useCatalogStore.getState().cancelInstall();
    expect(api.cancelInstallation).not.toHaveBeenCalled();
    expect(useCatalogStore.getState().installation).toEqual(current);
  });

  it("stops polling and stores the cancelled installation", async () => {
    api.installCatalogEntry.mockResolvedValue(installation());
    api.cancelInstallation.mockResolvedValue(installation({ stage: "error", cancelled: true }));

    await useCatalogStore.getState().installAgent("entry-1");
    await useCatalogStore.getState().cancelInstall();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(api.cancelInstallation).toHaveBeenCalledWith("inst-1");
    expect(api.getInstallation).not.toHaveBeenCalled();
    expect(useCatalogStore.getState().installation).toMatchObject({ cancelled: true });
  });
});

describe("useCatalogStore.adoptDetectedAgent", () => {
  const detection = { id: "det-1", descriptorId: "claude" } as CliDetection;

  it("toasts when the descriptor is not detected", async () => {
    api.getCliDetections.mockResolvedValue([detection]);
    await useCatalogStore.getState().adoptDetectedAgent("codex");
    expect(api.adoptDetection).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith("catalog.notDetected", "error");
  });

  it("adopts, verifies, refreshes, and selects the agent", async () => {
    useCatalogStore.setState({ selectedEntry: entry("claude") });
    api.getCliDetections.mockResolvedValue([detection]);
    api.adoptDetection.mockResolvedValue({ id: "agent-1" });
    api.getAgent.mockResolvedValue({ id: "agent-1" });

    await useCatalogStore.getState().adoptDetectedAgent("claude");

    expect(api.adoptDetection).toHaveBeenCalledWith("det-1");
    expect(api.getAgent).toHaveBeenCalledWith("agent-1", true);
    expect(api.getCatalog).toHaveBeenCalledTimes(1);
    expect(fetchAgents).toHaveBeenCalledTimes(1);
    expect(selectAgent).toHaveBeenCalledWith("agent-1");
    expect(addToast).toHaveBeenCalledWith("catalog.added", "success");
    expect(useCatalogStore.getState().selectedEntry).toBeNull();
  });

  it("refreshes but does not select when verification fails", async () => {
    useCatalogStore.setState({ selectedEntry: entry("claude") });
    api.getCatalog.mockResolvedValue([entry("claude")]);
    api.getCliDetections.mockResolvedValue([detection]);
    api.adoptDetection.mockResolvedValue({ id: "agent-1" });
    api.getAgent.mockRejectedValue(new Error("unreachable"));

    await useCatalogStore.getState().adoptDetectedAgent("claude");

    expect(addToast).toHaveBeenCalledWith("catalog.verificationFailed", "error");
    expect(api.getCatalog).toHaveBeenCalledTimes(1);
    expect(fetchAgents).toHaveBeenCalledTimes(1);
    expect(selectAgent).not.toHaveBeenCalled();
    expect(useCatalogStore.getState().selectedEntry).toMatchObject({ id: "claude" });
  });

  it("toasts a generic failure when adoption throws", async () => {
    api.getCliDetections.mockResolvedValue([detection]);
    api.adoptDetection.mockRejectedValue(new Error("boom"));

    await useCatalogStore.getState().adoptDetectedAgent("claude");

    expect(addToast).toHaveBeenCalledWith("catalog.failed", "error");
    expect(selectAgent).not.toHaveBeenCalled();
  });
});
