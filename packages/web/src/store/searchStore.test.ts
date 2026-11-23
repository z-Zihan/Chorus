import { beforeEach, describe, expect, it, vi } from "vitest";

const { searchMessages } = vi.hoisted(() => ({ searchMessages: vi.fn() }));

vi.mock("@/services/api", () => ({ api: { searchMessages } }));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/utils/logger", () => ({ logger: { error: vi.fn() } }));

import type { MessageSearchResult } from "@/services/api";
import { useSearchStore } from "./searchStore";

const initialState = useSearchStore.getState();

function result(id: string): MessageSearchResult {
  return { message: { id } } as unknown as MessageSearchResult;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  searchMessages.mockReset();
  useSearchStore.setState(initialState, true);
});

describe("useSearchStore", () => {
  it("merges filters and sets the query", () => {
    const store = useSearchStore.getState();
    store.setQuery("hello");
    store.setFilters({ agentId: "agent-1" });
    store.setFilters({ startDate: 10 });
    expect(useSearchStore.getState()).toMatchObject({
      query: "hello",
      filters: { agentId: "agent-1", startDate: 10 },
    });
  });

  it("searches with the trimmed query and current filters", async () => {
    searchMessages.mockResolvedValue([result("m1")]);
    useSearchStore.getState().setFilters({ agentId: "agent-1" });

    const pending = useSearchStore.getState().search("  hello  ");
    expect(useSearchStore.getState()).toMatchObject({ query: "  hello  ", isSearching: true });
    await pending;

    expect(searchMessages).toHaveBeenCalledWith("hello", { agentId: "agent-1" }, true);
    expect(useSearchStore.getState()).toMatchObject({
      results: [result("m1")],
      isSearching: false,
      error: null,
    });
  });

  it("clears results without calling the API for blank queries", async () => {
    useSearchStore.setState({ results: [result("old")], error: "stale" });
    await useSearchStore.getState().search("   ");
    expect(searchMessages).not.toHaveBeenCalled();
    expect(useSearchStore.getState()).toMatchObject({
      query: "   ",
      results: [],
      isSearching: false,
      error: null,
    });
  });

  it("surfaces a translated error and empties results on failure", async () => {
    useSearchStore.setState({ results: [result("old")] });
    searchMessages.mockRejectedValue(new Error("boom"));
    await useSearchStore.getState().search("hello");
    expect(useSearchStore.getState()).toMatchObject({
      results: [],
      isSearching: false,
      error: "common:search.loadFailed",
    });
  });

  it("ignores responses from superseded searches", async () => {
    const first = deferred<MessageSearchResult[]>();
    const second = deferred<MessageSearchResult[]>();
    searchMessages.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const firstSearch = useSearchStore.getState().search("first");
    const secondSearch = useSearchStore.getState().search("second");
    second.resolve([result("second")]);
    await secondSearch;
    first.resolve([result("first")]);
    await firstSearch;

    expect(useSearchStore.getState()).toMatchObject({
      query: "second",
      results: [result("second")],
      isSearching: false,
    });
  });

  it("ignores failures from superseded searches", async () => {
    const first = deferred<MessageSearchResult[]>();
    searchMessages.mockReturnValueOnce(first.promise).mockResolvedValueOnce([result("second")]);

    const firstSearch = useSearchStore.getState().search("first");
    await useSearchStore.getState().search("second");
    first.reject(new Error("late failure"));
    await firstSearch;

    expect(useSearchStore.getState()).toMatchObject({ results: [result("second")], error: null });
  });

  it("clearResults resets state and drops in-flight responses", async () => {
    const pending = deferred<MessageSearchResult[]>();
    searchMessages.mockReturnValueOnce(pending.promise);

    const search = useSearchStore.getState().search("hello");
    useSearchStore.getState().clearResults();
    pending.resolve([result("late")]);
    await search;

    expect(useSearchStore.getState()).toMatchObject({
      query: "",
      results: [],
      isSearching: false,
      error: null,
    });
  });
});
