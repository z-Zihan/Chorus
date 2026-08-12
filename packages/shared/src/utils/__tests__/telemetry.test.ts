import { describe, expect, it, vi } from "vitest";
import { TelemetryClient, type TelemetryProvider } from "../telemetry";

describe("TelemetryClient", () => {
  it("does not retain or emit events before a provider is installed", () => {
    const client = new TelemetryClient();
    expect(() => client.track("unused_placeholder")).not.toThrow();
    expect(Object.keys(client)).toEqual(["provider"]);
  });

  it("can install an SDK adapter without changing call sites", async () => {
    const provider: TelemetryProvider = {
      initialize: vi.fn(),
      track: vi.fn(),
      flush: vi.fn(),
      shutdown: vi.fn(),
    };
    const client = new TelemetryClient();
    await client.setProvider(provider);
    client.track("future_event", { source: "test" });
    await client.flush();

    expect(provider.initialize).toHaveBeenCalledOnce();
    expect(provider.track).toHaveBeenCalledWith(
      expect.objectContaining({ name: "future_event", properties: { source: "test" } }),
    );
    expect(provider.flush).toHaveBeenCalledOnce();
  });
});
