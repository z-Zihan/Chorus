export interface AnalyticsEvent {
  name: string;
  props?: Record<string, string | number | boolean>;
  timestamp: number;
}

export interface AnalyticsProvider {
  track(event: AnalyticsEvent): void;
  flush?(): Promise<void>;
}

export class ConsoleAnalyticsProvider implements AnalyticsProvider {
  track(event: AnalyticsEvent): void {
    console.debug("[analytics]", event.name, event.props ?? {}, event.timestamp);
  }
}

export class NoopAnalyticsProvider implements AnalyticsProvider {
  track(_event: AnalyticsEvent): void {}
}

// Provider stub: initialize an SDK here and forward events from track(). The same
// pattern can be used for PostHog (posthog.capture) or Umami (umami.track).
export class SentryAnalyticsProvider implements AnalyticsProvider {
  track(_event: AnalyticsEvent): void {
    // Sentry.addBreadcrumb({ category: "analytics", message: event.name, data: event.props });
  }
}

const MAX_EVENTS = 1_000;
const providers = new Map<string, AnalyticsProvider>();
const eventQueue: AnalyticsEvent[] = [];

providers.set("console", new ConsoleAnalyticsProvider());
providers.set("noop", new NoopAnalyticsProvider());
providers.set("sentry", new SentryAnalyticsProvider());

const configuredProvider = import.meta.env.VITE_ANALYTICS_PROVIDER?.trim().toLowerCase();
let activeProvider = providers.get(configuredProvider || (import.meta.env.DEV ? "console" : "noop"))
  ?? providers.get("noop")!;

export function registerAnalyticsProvider(name: string, provider: AnalyticsProvider): void {
  providers.set(name.trim().toLowerCase(), provider);
  if (configuredProvider === name.trim().toLowerCase()) activeProvider = provider;
}

export function track(
  name: string,
  props?: Record<string, string | number | boolean>,
): void {
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
