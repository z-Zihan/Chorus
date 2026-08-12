import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { P2PDiscoveredHub, HubConfig } from "@chorus/shared";
import Fastify from "fastify";
import type { FastifyBaseLogger } from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import websocket from "@fastify/websocket";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/index.js";
import { Repository } from "./db/repository.js";
import { AgentRegistry } from "./agent/registry.js";
import { AgentRuntime } from "./agent/runtime.js";
import { EventHub } from "./ws/events.js";
import { registerWebSocket } from "./ws/handler.js";
import { registerRoutes } from "./routes/index.js";
import { flushAnalytics, track } from "./analytics.js";
import { logger } from "./utils/logger.js";
import { CliDetector } from "./cli-detector/index.js";
import { OnboardingService } from "./routes/onboarding.js";
import { Scheduler } from "./scheduler/index.js";
import { authMiddleware } from "./middleware/auth.js";
import { PluginLoader } from "./plugins/index.js";
import { HubIdentity } from "./hub/identity.js";
import { RelayClient } from "./hub/relay-client.js";
import { HubMessageRouter } from "./hub/message-router.js";
import { P2PDiscovery } from "./hub/p2p-discovery.js";
import { P2PListener } from "./hub/p2p-listener.js";
import { ConnectionManager } from "./hub/connection-manager.js";
import { deriveUserId } from "./identity/user-keys.js";
import { DirectoryService } from "./hub/directory.js";
import { TrustStore } from "./hub/trust-store.js";
import { PairingService } from "./hub/pairing-service.js";
import { TokenStore } from "./auth/token-store.js";
import { signEnvelope } from "./hub/crypto.js";

function monitorDesktopParent(): void {
  const expectedParentPid = Number.parseInt(process.env.CHORUS_PARENT_PID ?? "", 10);
  if (!Number.isInteger(expectedParentPid) || expectedParentPid <= 1) return;

  const timer = setInterval(() => {
    if (process.ppid === expectedParentPid) return;
    clearInterval(timer);
    logger.warn(
      { expectedParentPid, currentParentPid: process.ppid },
      "Desktop parent exited; stopping server sidecar",
    );
    process.kill(process.pid, "SIGTERM");
  }, 1_000);
  timer.unref();
}

monitorDesktopParent();

process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception");
  track("error", { message: error.message, source: "uncaughtException" });
  void flushAnalytics().finally(() => process.exit(1));
});

process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  logger.error({ err: error }, "Unhandled promise rejection");
  track("error", { message: error.message, source: "unhandledRejection" });
});

async function main(): Promise<void> {
  const { config, rootDir } = await loadConfig();
  const dbPath = resolve(rootDir, config.dbPath);

  const { sqlite, db } = createDatabase(dbPath);
  const repository = new Repository({ sqlite, db });
  const tokenStore = new TokenStore(repository);
  const localUser = await repository.getOrCreateLocalUser("本机用户");
  if (!localUser.publicKey) throw new Error("Local User public key is unavailable");
  const localProtocolUser = {
    id: deriveUserId(localUser.publicKey),
    name: localUser.name,
  };
  const hubIdentity = new HubIdentity(resolve(rootDir, "data/hub-keypair.json"));
  const relayClient = new RelayClient();
  let p2pDiscovery: P2PDiscovery | undefined;
  let p2pListener: P2PListener | undefined;
  let connectionManager: ConnectionManager | undefined;
  let messageRouter: HubMessageRouter | undefined;
  let pairingService: PairingService | undefined;
  let relayToken = config.hub?.relay.token;

  // Always initialize Hub identity so routes are available
  await hubIdentity.getOrCreateKeypair();
  const trustStore = new TrustStore(repository, hubIdentity.hubId);

  const registry = new AgentRegistry(repository, relayClient);
  await registry.initialize(config.agents);
  registry.startHealthChecks();
  registry.watchConfig(resolve(rootDir, "chorus.config.ts"));

  const events = new EventHub();
  const pluginLoader = new PluginLoader();
  await pluginLoader.loadPlugins(resolve(rootDir, "plugins"));
  await pluginLoader.initPlugins({ registry, repository, events, logger });
  const runtime = new AgentRuntime(repository, registry, events, config, relayClient);
  let connectHub: (() => Promise<void>) | undefined;
  const hubConfig: HubConfig = config.hub ?? {
    enabled: true,
    displayName: "My Device",
    relay: { url: "" },
    p2p: { enabled: false, port: 3212, discovery: "none" },
  };
  if (hubIdentity && relayClient) {
    const identity = hubIdentity;
    const client = relayClient;
    const listener = new P2PListener();
    const manager = new ConnectionManager(listener, client);
    connectionManager = manager;
    const directoryService = new DirectoryService(repository, registry, identity.hubId, trustStore);
    pairingService = new PairingService(
      identity,
      client,
      trustStore,
      repository,
      localProtocolUser.name,
    );
    messageRouter = new HubMessageRouter(
      identity,
      registry,
      runtime,
      client,
      manager,
      localProtocolUser,
      directoryService,
      trustStore,
      repository,
      pairingService,
    );
    runtime.setHubMessageRouter(messageRouter);
    if (hubConfig.p2p.enabled) {
      const discovery = new P2PDiscovery();
      const p2pPort = hubConfig.p2p.port ?? 3212;
      const connectPeer = (hub: P2PDiscoveredHub) => {
        listener.setPeerPublicKey(hub.hubId, hub.publicKey);
        if (listener.isConnected(hub.hubId)) return;
        void listener.connectToHub(hub).catch((error: unknown) => {
          logger.warn({ err: error, hubId: hub.hubId }, "P2P connection attempt failed");
        });
      };
      const listeningPort = await listener.start(p2pPort, identity);
      listener.startHealthChecks();
      messageRouter.setP2PListener(listener);
      discovery.onDiscovered(connectPeer);
      client.onPresence((hubId, status) => {
        if (status !== "online") return;
        const hub = discovery.discover().find((candidate) => candidate.hubId === hubId);
        if (hub) connectPeer(hub);
      });
      discovery.start(
        identity.hubId,
        identity.getPublicKey(),
        hubConfig.displayName,
        listeningPort,
      );
      p2pDiscovery = discovery;
      p2pListener = listener;
    }
    connectHub = async () => {
      if (!hubConfig.relay.url) throw new Error("Relay URL not configured");
      relayToken = await registerHub(
        hubConfig.relay.url,
        identity.getPublicKey(),
        hubConfig.displayName,
        await identity.getSecretKey(),
      );
      await client.connect(hubConfig.relay.url, identity.hubId, relayToken, async () =>
        registerHub(
          hubConfig.relay.url,
          identity.getPublicKey(),
          hubConfig.displayName,
          await identity.getSecretKey(),
        ),
      );
    };
  }
  const scheduler = new Scheduler(repository, runtime);
  scheduler.initialize();
  const detector = new CliDetector();
  const onboarding = new OnboardingService(repository, registry, detector);

  const app = Fastify({ loggerInstance: logger as FastifyBaseLogger });

  app.addHook("onRequest", async (request) => {
    request.log.info({ method: request.method, url: request.url }, "Request received");
  });
  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      { method: request.method, url: request.url, statusCode: reply.statusCode },
      "Request completed",
    );
  });
  app.addHook("onRequest", authMiddleware(config.auth, tokenStore));

  await app.register(cors, { origin: config.cors.origin });
  await app.register(websocket);

  registerRoutes(
    app,
    repository,
    registry,
    runtime,
    scheduler,
    detector,
    onboarding,
    undefined,
    undefined,
    pluginLoader,
    hubIdentity && relayClient && connectionManager && connectHub
      ? {
          identity: hubIdentity,
          repository,
          relayClient,
          registry,
          connectionManager,
          hubConfig,
          connect: connectHub,
        }
      : undefined,
    trustStore,
    pairingService,
    tokenStore,
    config.auth,
  );
  registerWebSocket(app, events, runtime, registry, config.auth, tokenStore);

  const hasAgentsAtStartup = registry.list().length > 0;
  if (hasAgentsAtStartup) await onboarding.bootstrap();

  if (connectHub) {
    void connectHub().catch((error: unknown) => {
      app.log.warn({ err: error }, "Initial Relay connection failed");
    });
  }

  const webDist = resolve(rootDir, "packages/web/dist");
  if (existsSync(webDist)) {
    await app.register(staticPlugin, { root: webDist, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (
        request.raw.method === "GET" &&
        !request.url.startsWith("/api/") &&
        request.url !== "/ws"
      ) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not found" });
    });
  }

  const close = async () => {
    p2pDiscovery?.stop();
    await p2pListener?.stop();
    relayClient?.disconnect();
    messageRouter?.destroy();
    await app.close();
    scheduler.destroy();
    registry.stopHealthChecks();
    registry.stopWatchingConfig();
    pluginLoader.destroyPlugins();
    for (const agent of registry.list()) registry.getAdapter(agent.id)?.destroy?.();
    sqlite.close();
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());

  const serverHost = config.host ?? "127.0.0.1";
  await app.listen({ host: serverHost, port: config.port });
  app.log.info(`Chorus server running on http://${serverHost}:${config.port}`);
  if (!hasAgentsAtStartup) {
    void onboarding.bootstrap().catch((error) => {
      app.log.error({ err: error }, "Automatic CLI detection failed");
    });
  }
}

async function registerHub(
  relayWebSocketUrl: string,
  publicKey: string,
  displayName: string,
  secretKey: string,
): Promise<string> {
  const url = new URL(relayWebSocketUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/api/hubs/challenge";
  url.search = "";
  url.hash = "";
  const challengeResponse = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hubId: publicKey, publicKey, displayName }),
  });
  if (!challengeResponse.ok) {
    throw new Error(`Relay registration challenge failed with HTTP ${challengeResponse.status}`);
  }
  const challenge = (await challengeResponse.json()) as Record<string, unknown>;
  if (typeof challenge.challengeId !== "string" || typeof challenge.nonce !== "string") {
    throw new Error("Relay registration challenge is invalid");
  }
  const signature = await signEnvelope(challenge, secretKey);
  url.pathname = "/api/hubs/register";
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challengeId: challenge.challengeId, signature }),
  });
  if (!response.ok) throw new Error(`Relay Hub registration failed with HTTP ${response.status}`);
  const body = (await response.json()) as { token?: unknown };
  if (typeof body.token !== "string" || !body.token) {
    throw new Error("Relay Hub registration returned no token");
  }
  return body.token;
}

main().catch((err) => {
  const error = err instanceof Error ? err : new Error(String(err));
  logger.fatal({ err: error }, "Fatal startup error");
  track("error", { message: error.message, source: "startup" });
  process.exit(1);
});
