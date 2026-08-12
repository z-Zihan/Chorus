import { TelemetryClient, type TelemetryProvider } from "@chorus/shared";

/**
 * Reserved integration point for a future browser telemetry SDK. It is inert
 * until the application explicitly installs a provider.
 */
export const telemetry = new TelemetryClient();

export async function setTelemetryProvider(provider: TelemetryProvider): Promise<void> {
  await telemetry.setProvider(provider);
}
