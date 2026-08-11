import type { HubEnvelope, P2PDiscoveredHub } from "@chorus/shared";
import WebSocket, { type RawData, WebSocketServer } from "ws";
import { logger } from "../utils/logger.js";
import { signEnvelope, verifySignature } from "./crypto.js";
import type { HubIdentity } from "./identity.js";
import { P2PHandshake } from "./p2p-handshake.js";

type PeerListener = (hubId: string) => void;
type MessageListener = (hubId: string, envelope: HubEnvelope) => void;

export type P2PMessage =
  | { type: "p2p_register"; hubId: string; nonce: string }
  | { type: "p2p_challenge"; nonce: string }
  | { type: "p2p_response"; signature: string }
  | { type: "p2p_confirm"; signature: string }
  | { type: "p2p_message"; envelope: HubEnvelope; signature: string }
  | { type: "p2p_ping"; timestamp: number }
  | { type: "p2p_pong"; timestamp: number };

interface SocketState {
  outbound: boolean;
  authenticated: boolean;
  localNonce: string;
  hubId?: string;
  remoteNonce?: string;
}

const HANDSHAKE_TIMEOUT_MS = 10_000;
const PONG_TIMEOUT_MS = 5_000;
const RECONNECT_DELAY_MS = 5_000;
const MAX_PORT_ATTEMPTS = 5;

export class P2PListener {
  private server?: WebSocketServer;
  private identity?: HubIdentity;
  private readonly handshake = new P2PHandshake();
  private readonly connections = new Map<string, WebSocket>();
  private readonly peerPublicKeys = new Map<string, string>();
  private readonly discoveredPeers = new Map<string, P2PDiscoveredHub>();
  private readonly socketStates = new WeakMap<WebSocket, SocketState>();
  private readonly connectingPeers = new Set<string>();
  private readonly reconnectTimers = new Map<string, NodeJS.Timeout>();
  private readonly connectedListeners = new Set<PeerListener>();
  private readonly disconnectedListeners = new Set<PeerListener>();
  private readonly messageListeners = new Set<MessageListener>();
  private readonly p2pLatencies = new Map<string, number>();
  private readonly pendingPings = new Map<string, number>();
  private readonly pongTimers = new Map<string, NodeJS.Timeout>();
  private healthCheckTimer?: NodeJS.Timeout;
  listeningPort?: number;
  private stopping = true;

  async start(port: number, identity: HubIdentity): Promise<number> {
    if (this.server) return this.listeningPort ?? port;
    this.identity = identity;
    this.stopping = false;
    for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt += 1) {
      const candidatePort = port + attempt;
      if (candidatePort > 65_535) throw new Error("No valid P2P port remains to try");
      try {
        const server = await this.listen(candidatePort);
        this.server = server;
        this.listeningPort = candidatePort;
        return candidatePort;
      } catch (error) {
        if (!isAddressInUse(error) || attempt === MAX_PORT_ATTEMPTS - 1) throw error;
        logger.warn(
          { port: candidatePort, nextPort: candidatePort + 1 },
          "P2P port is in use; trying the next port",
        );
      }
    }
    throw new Error("Unable to start P2P listener");
  }

  setPeerPublicKey(hubId: string, publicKey: string): void {
    this.peerPublicKeys.set(hubId, publicKey);
  }

  isConnected(hubId: string): boolean {
    return this.connections.get(hubId)?.readyState === WebSocket.OPEN;
  }

  async connectToHub(hub: P2PDiscoveredHub): Promise<void> {
    const identity = this.requiredIdentity();
    this.discoveredPeers.set(hub.hubId, hub);
    this.setPeerPublicKey(hub.hubId, hub.publicKey);
    if (hub.hubId === identity.hubId || this.isConnected(hub.hubId)) return;
    if (this.connectingPeers.has(hub.hubId)) return;
    if (!hub.publicKey) throw new Error(`No discovered public key for P2P Hub ${hub.hubId}`);

    this.clearReconnectTimer(hub.hubId);
    this.connectingPeers.add(hub.hubId);
    const socket = new WebSocket(webSocketUrl(hub.host, hub.port));
    const state: SocketState = {
      outbound: true,
      authenticated: false,
      hubId: hub.hubId,
      localNonce: this.handshake.createChallenge(),
    };
    this.socketStates.set(socket, state);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(
        () => socket.close(1008, "P2P handshake timed out"),
        HANDSHAKE_TIMEOUT_MS,
      );
      timer.unref();
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.connectingPeers.delete(hub.hubId);
        if (error) reject(error);
        else resolve();
      };
      socket.on("open", () => {
        this.send(socket, {
          type: "p2p_register",
          hubId: identity.hubId,
          nonce: state.localNonce,
        });
      });
      socket.on("message", (data) => {
        void this.handleOutgoingMessage(socket, state, data)
          .then(() => {
            if (state.authenticated) finish();
          })
          .catch((error: unknown) => {
            const reason = error instanceof Error ? error : new Error(String(error));
            socket.close(1008, reason.message);
            finish(reason);
          });
      });
      socket.on("error", (error) => {
        if (!state.authenticated) finish(error);
      });
      socket.on("close", () => {
        this.handleClose(socket, state);
        if (!state.authenticated) finish(new Error(`P2P connection to ${hub.hubId} closed`));
      });
    });
  }

  async sendToHub(hubId: string, data: HubEnvelope): Promise<boolean> {
    const socket = this.connections.get(hubId);
    if (socket?.readyState !== WebSocket.OPEN) return false;
    const signature = await signEnvelope(data, await this.requiredIdentity().getSecretKey());
    if (this.connections.get(hubId) !== socket || socket.readyState !== WebSocket.OPEN)
      return false;
    this.send(socket, { type: "p2p_message", envelope: data, signature });
    return true;
  }

  startHealthChecks(intervalMs = 30_000): void {
    this.stopHealthChecks();
    this.healthCheckTimer = setInterval(() => this.pingConnectedPeers(), intervalMs);
    this.healthCheckTimer.unref();
  }

  stopHealthChecks(): void {
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
    this.healthCheckTimer = undefined;
    for (const timer of this.pongTimers.values()) clearTimeout(timer);
    this.pongTimers.clear();
    this.pendingPings.clear();
  }

  getP2PLatency(hubId: string): number | null {
    if (!this.isConnected(hubId)) return null;
    return this.p2pLatencies.get(hubId) ?? null;
  }

  onPeerConnected(callback: PeerListener): () => void {
    this.connectedListeners.add(callback);
    return () => this.connectedListeners.delete(callback);
  }

  onPeerDisconnected(callback: PeerListener): () => void {
    this.disconnectedListeners.add(callback);
    return () => this.disconnectedListeners.delete(callback);
  }

  onMessage(callback: MessageListener): () => void {
    this.messageListeners.add(callback);
    return () => this.messageListeners.delete(callback);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.stopHealthChecks();
    const server = this.server;
    this.server = undefined;
    this.listeningPort = undefined;
    this.connectingPeers.clear();
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    for (const socket of this.connections.values()) socket.close(1001, "P2P listener stopped");
    this.connections.clear();
    this.p2pLatencies.clear();
    this.discoveredPeers.clear();
    this.peerPublicKeys.clear();
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private acceptConnection(socket: WebSocket): void {
    const state: SocketState = {
      outbound: false,
      authenticated: false,
      localNonce: this.handshake.createChallenge(),
    };
    this.socketStates.set(socket, state);
    const timer = setTimeout(
      () => socket.close(1008, "P2P registration required"),
      HANDSHAKE_TIMEOUT_MS,
    );
    timer.unref();
    socket.on("message", (data) => {
      void this.handleIncomingMessage(socket, state, data)
        .then(() => {
          if (state.authenticated) clearTimeout(timer);
        })
        .catch((error: unknown) => {
          const reason = error instanceof Error ? error : new Error(String(error));
          socket.close(1008, reason.message);
        });
    });
    socket.on("error", (error) => logger.warn({ err: error }, "P2P peer socket error"));
    socket.on("close", () => {
      clearTimeout(timer);
      this.handleClose(socket, state);
    });
  }

  private async handleIncomingMessage(
    socket: WebSocket,
    state: SocketState,
    data: RawData,
  ): Promise<void> {
    const message = parseMessage(data);
    if (!message) throw new Error("Invalid P2P message");
    if (state.authenticated) {
      await this.deliverMessage(socket, state, message);
      return;
    }
    if (!state.hubId) {
      if (message.type !== "p2p_register" || !message.hubId || !message.nonce) {
        throw new Error("P2P registration required");
      }
      if (!this.peerPublicKeys.has(message.hubId)) {
        throw new Error("P2P peer public key was not discovered");
      }
      state.hubId = message.hubId;
      state.remoteNonce = message.nonce;
      this.send(socket, { type: "p2p_challenge", nonce: state.localNonce });
      return;
    }
    if (message.type !== "p2p_response" || !state.remoteNonce) {
      throw new Error("P2P challenge response required");
    }
    const publicKey = this.peerPublicKeys.get(state.hubId);
    if (
      !publicKey ||
      !(await this.handshake.verifyChallenge(state.localNonce, message.signature, publicKey))
    ) {
      throw new Error("Invalid P2P challenge signature");
    }
    const signature = await this.handshake.signChallenge(
      state.remoteNonce,
      await this.requiredIdentity().getSecretKey(),
    );
    this.send(socket, { type: "p2p_confirm", signature });
    this.authenticate(socket, state);
  }

  private async handleOutgoingMessage(
    socket: WebSocket,
    state: SocketState,
    data: RawData,
  ): Promise<void> {
    const message = parseMessage(data);
    if (!message) throw new Error("Invalid P2P message");
    if (state.authenticated) {
      await this.deliverMessage(socket, state, message);
      return;
    }
    if (!state.remoteNonce) {
      if (message.type !== "p2p_challenge" || !message.nonce) {
        throw new Error("P2P challenge required");
      }
      state.remoteNonce = message.nonce;
      const signature = await this.handshake.signChallenge(
        message.nonce,
        await this.requiredIdentity().getSecretKey(),
      );
      this.send(socket, { type: "p2p_response", signature });
      return;
    }
    if (message.type !== "p2p_confirm" || !state.hubId) {
      throw new Error("P2P confirmation required");
    }
    const publicKey = this.peerPublicKeys.get(state.hubId);
    if (
      !publicKey ||
      !(await this.handshake.verifyChallenge(state.localNonce, message.signature, publicKey))
    ) {
      throw new Error("Invalid P2P confirmation signature");
    }
    this.authenticate(socket, state);
  }

  private authenticate(socket: WebSocket, state: SocketState): void {
    const hubId = state.hubId;
    if (!hubId) throw new Error("Cannot authenticate an unidentified P2P peer");
    const existing = this.connections.get(hubId);
    if (existing && existing !== socket) existing.close(1000, "P2P connection replaced");
    this.clearPeerHealth(hubId);
    this.clearReconnectTimer(hubId);
    state.authenticated = true;
    this.connections.set(hubId, socket);
    logger.info({ hubId }, "P2P peer authenticated");
    for (const listener of this.connectedListeners) listener(hubId);
  }

  private async deliverMessage(
    socket: WebSocket,
    state: SocketState,
    message: P2PMessage,
  ): Promise<void> {
    if (!state.hubId) return;
    if (message.type === "p2p_ping") {
      this.send(socket, { type: "p2p_pong", timestamp: Date.now() });
      return;
    }
    if (message.type === "p2p_pong") {
      this.handlePong(state.hubId);
      return;
    }
    if (message.type === "p2p_message") {
      const publicKey = this.peerPublicKeys.get(state.hubId);
      if (!publicKey || !(await verifySignature(message.envelope, message.signature, publicKey))) {
        throw new Error("Invalid P2P message signature");
      }
      for (const listener of this.messageListeners) listener(state.hubId, message.envelope);
    }
  }

  private handleClose(socket: WebSocket, state: SocketState): void {
    const hubId = state.hubId;
    if (!hubId || this.connections.get(hubId) !== socket) return;
    this.connections.delete(hubId);
    this.clearPeerHealth(hubId);
    logger.info({ hubId }, "P2P peer disconnected");
    for (const listener of this.disconnectedListeners) listener(hubId);
    this.scheduleReconnect(hubId);
  }

  private listen(port: number): Promise<WebSocketServer> {
    return new Promise((resolve, reject) => {
      const server = new WebSocketServer({ port });
      const onListening = () => {
        server.off("error", onError);
        server.on("connection", (socket) => this.acceptConnection(socket));
        server.on("error", (error) => logger.warn({ err: error }, "P2P WebSocket server error"));
        resolve(server);
      };
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      server.once("listening", onListening);
      server.once("error", onError);
    });
  }

  private scheduleReconnect(hubId: string): void {
    const hub = this.discoveredPeers.get(hubId);
    if (this.stopping || !hub || this.reconnectTimers.has(hubId)) return;
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(hubId);
      if (this.stopping || this.isConnected(hubId)) return;
      void this.connectToHub(hub).catch((error: unknown) => {
        logger.warn({ err: error, hubId }, "P2P reconnection attempt failed");
        this.scheduleReconnect(hubId);
      });
    }, RECONNECT_DELAY_MS);
    timer.unref();
    this.reconnectTimers.set(hubId, timer);
  }

  private clearReconnectTimer(hubId: string): void {
    const timer = this.reconnectTimers.get(hubId);
    if (timer) clearTimeout(timer);
    this.reconnectTimers.delete(hubId);
  }

  private requiredIdentity(): HubIdentity {
    if (!this.identity) throw new Error("P2P listener has not been started");
    return this.identity;
  }

  private send(socket: WebSocket, message: P2PMessage): void {
    if (socket.readyState !== WebSocket.OPEN) throw new Error("P2P socket is not open");
    socket.send(JSON.stringify(message));
  }

  private pingConnectedPeers(): void {
    for (const [hubId, socket] of this.connections) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      const timestamp = Date.now();
      this.pendingPings.set(hubId, timestamp);
      this.send(socket, { type: "p2p_ping", timestamp });
      const existingTimer = this.pongTimers.get(hubId);
      if (existingTimer) clearTimeout(existingTimer);
      const timer = setTimeout(() => {
        this.pongTimers.delete(hubId);
        this.pendingPings.delete(hubId);
        if (this.connections.get(hubId) !== socket) return;
        logger.warn({ hubId }, "P2P peer pong timeout; closing unhealthy connection");
        socket.close(1011, "P2P health check timed out");
      }, PONG_TIMEOUT_MS);
      timer.unref();
      this.pongTimers.set(hubId, timer);
    }
  }

  private handlePong(hubId: string): void {
    const timestamp = this.pendingPings.get(hubId);
    if (timestamp === undefined) return;
    this.pendingPings.delete(hubId);
    const timer = this.pongTimers.get(hubId);
    if (timer) clearTimeout(timer);
    this.pongTimers.delete(hubId);
    this.p2pLatencies.set(hubId, Date.now() - timestamp);
  }

  private clearPeerHealth(hubId: string): void {
    const timer = this.pongTimers.get(hubId);
    if (timer) clearTimeout(timer);
    this.pongTimers.delete(hubId);
    this.pendingPings.delete(hubId);
    this.p2pLatencies.delete(hubId);
  }
}

function parseMessage(data: RawData): P2PMessage | null {
  try {
    const value = JSON.parse(data.toString()) as unknown;
    return typeof value === "object" && value !== null && "type" in value
      ? (value as P2PMessage)
      : null;
  } catch {
    return null;
  }
}

function webSocketUrl(host: string, port: number): string {
  const formattedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `ws://${formattedHost}:${port}`;
}

function isAddressInUse(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes("EADDRINUSE") || error.message.includes("in use");
  }
  return false;
}
