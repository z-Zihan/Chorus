import { TelemetryClient, type TelemetryProvider } from "@chorus/shared";

/**
 * Reserved integration point for a future telemetry SDK. No provider is
 * installed today, so it performs no collection, buffering, persistence, or IO.
 */
export const telemetry = new TelemetryClient();

export async function setTelemetryProvider(provider: TelemetryProvider): Promise<void> {
  await telemetry.setProvider(provider);
}
