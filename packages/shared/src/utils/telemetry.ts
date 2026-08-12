export type TelemetryProperty = string | number | boolean | null;

export interface TelemetryEvent {
  name: string;
  properties?: Readonly<Record<string, TelemetryProperty>>;
  timestamp: number;
}

/** Adapter contract for a future first-party or third-party telemetry SDK. */
export interface TelemetryProvider {
  initialize?(): void | Promise<void>;
  track(event: TelemetryEvent): void | Promise<void>;
  flush?(): void | Promise<void>;
  shutdown?(): void | Promise<void>;
}

export class NoopTelemetryProvider implements TelemetryProvider {
  initialize(): void {}
  track(_event: TelemetryEvent): void {}
  flush(): void {}
  shutdown(): void {}
}

/**
 * Provider-neutral telemetry entry point. It deliberately has no event queue,
 * storage, identifiers, or network transport. Until a provider is explicitly
 * installed, calls are discarded by the Noop provider.
 */
export class TelemetryClient {
  private provider: TelemetryProvider = new NoopTelemetryProvider();

  async setProvider(provider: TelemetryProvider): Promise<void> {
    await this.provider.shutdown?.();
    this.provider = provider;
    await provider.initialize?.();
  }

  track(name: string, properties?: Readonly<Record<string, TelemetryProperty>>): void {
    try {
      const result = this.provider.track({ name, properties, timestamp: Date.now() });
      if (result instanceof Promise) void result.catch(() => undefined);
    } catch {
      // Observability must never break the product path.
    }
  }

  async flush(): Promise<void> {
    await this.provider.flush?.();
  }

  async shutdown(): Promise<void> {
    await this.provider.shutdown?.();
    this.provider = new NoopTelemetryProvider();
  }
}
