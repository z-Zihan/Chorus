export interface AnalyticsEvent {
  name: string;
  props?: Record<string, string | number | boolean>;
  timestamp: number;
}

export interface AnalyticsProvider {
  track(event: AnalyticsEvent): void;
  flush?(): Promise<void>;
}

export class NoopAnalyticsProvider implements AnalyticsProvider {
  track(_event: AnalyticsEvent): void {}
}

// Stub for an eventual Sentry integration. PostHog and Umami providers can be
// registered the same way and forward event.name/event.props to their SDKs.
export class SentryAnalyticsProvider implements AnalyticsProvider {
  track(_event: AnalyticsEvent): void {
    // Sentry.addBreadcrumb({ category: "analytics", message: event.name, data: event.props });
  }
}

const MAX_EVENTS = 1_000;
const providers = new Map<string, AnalyticsProvider>();
const eventQueue: AnalyticsEvent[] = [];
const configuredProvider = process.env.SERVER_ANALYTICS_PROVIDER?.trim().toLowerCase() || "noop";

const noopProvider = new NoopAnalyticsProvider();
providers.set("noop", noopProvider);
providers.set("sentry", new SentryAnalyticsProvider());
let activeProvider: AnalyticsProvider = providers.get(configuredProvider) ?? noopProvider;

export function registerAnalyticsProvider(name: string, provider: AnalyticsProvider): void {
  const normalizedName = name.trim().toLowerCase();
  providers.set(normalizedName, provider);
  if (configuredProvider === normalizedName) activeProvider = provider;
}

export function track(name: string, props?: Record<string, string | number | boolean>): void {
  const event: AnalyticsEvent = { name, props, timestamp: Date.now() };
  eventQueue.push(event);
  if (eventQueue.length > MAX_EVENTS) eventQueue.splice(0, eventQueue.length - MAX_EVENTS);
  activeProvider.track(event);
}

export function getAnalyticsEvents(): AnalyticsEvent[] {
  return [...eventQueue];
}

export async function flushAnalytics(): Promise<void> {
  await activeProvider.flush?.();
}
