import type {
  HubConnectionState,
  HubEnvelope,
  RelayClientMessage,
  RelayServerMessage,
  RoomCasResult,
  RoomCasState,
  RoomMember,
  RoomInfo,
} from "@chorus/shared";
import WebSocket, { type RawData } from "ws";
import { logger } from "../utils/logger.js";

type MessageListener = (envelope: HubEnvelope) => void;
type PresenceListener = (hubId: string, status: "online" | "offline") => void;
type OfflineMessagesListener = (envelopes: HubEnvelope[]) => void;
type StateListener = (state: HubConnectionState) => void;
type RoomEventListener = (
  roomId: string,
  event: "join" | "leave" | "invite",
  hubId: string,
) => void;
type RoomMembersListener = (roomId: string, members: RoomMember[]) => void;

const HEARTBEAT_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const ROOM_CAS_TIMEOUT_MS = 10_000;

interface PendingRoomCas {
  resolve: (result: RoomCasResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class RelayClient {
  private socket?: WebSocket;
  private connectionState: HubConnectionState = "disconnected";
  private url?: string;
  private hubId?: string;
  private token?: string;
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private pongTimer?: NodeJS.Timeout;
  private shouldReconnect = false;
  private connectionGeneration = 0;
  private readonly messageListeners = new Set<MessageListener>();
  private readonly presenceListeners = new Set<PresenceListener>();
  private readonly offlineListeners = new Set<OfflineMessagesListener>();
  private readonly stateListeners = new Set<StateListener>();
  private readonly roomEventListeners = new Set<RoomEventListener>();
  private readonly roomMembersListeners = new Set<RoomMembersListener>();
  private readonly peerPublicKeys = new Map<string, string>();
  private readonly roomMembers = new Map<string, RoomMember[]>();
  private readonly pendingRoomCas = new Map<string, PendingRoomCas[]>();

  get state(): HubConnectionState {
    return this.connectionState;
  }

  get currentHubId(): string | undefined {
    return this.hubId;
  }

  async connect(url: string, hubId: string, token: string): Promise<void> {
    if (!url || !hubId || !token) throw new Error("Relay URL, Hub ID, and token are required");
    this.url = url;
    this.hubId = hubId;
    this.token = token;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    this.clearReconnectTimer();
    if (this.connectionState === "connected" && this.socket?.readyState === WebSocket.OPEN) return;
    await this.openSocket(false);
  }

  sendEnvelope(envelope: HubEnvelope): void {
    this.send({ type: "message", envelope });
  }

  joinRoom(roomId: string): void {
    this.send({ type: "room:join", roomId });
  }

  leaveRoom(roomId: string): void {
    this.send({ type: "room:leave", roomId });
  }

  roomCas(roomId: string, expected: RoomCasState, next: RoomCasState): Promise<RoomCasResult> {
    return new Promise<RoomCasResult>((resolve, reject) => {
      const pending: PendingRoomCas = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.removePendingRoomCas(roomId, pending);
          reject(new Error(`Room CAS timed out for ${roomId}`));
        }, ROOM_CAS_TIMEOUT_MS),
      };
      pending.timer.unref();
      const queue = this.pendingRoomCas.get(roomId) ?? [];
      queue.push(pending);
      this.pendingRoomCas.set(roomId, queue);
      try {
        this.send({
          type: "room_cas",
          roomId,
          expectedRevision: expected.revision,
          expectedKeyEpoch: expected.keyEpoch,
          newRevision: next.revision,
          newKeyEpoch: next.keyEpoch,
        });
      } catch (error) {
        clearTimeout(pending.timer);
        this.removePendingRoomCas(roomId, pending);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async createRoomRequest(relayUrl: string, name: string): Promise<RoomInfo> {
    const room = await this.roomRequest<RoomInfo>(relayUrl, "/api/rooms", {
      method: "POST",
      body: JSON.stringify({ name, createdBy: this.hubId }),
    });
    this.cacheRoomMembers(room.id, room.members);
    return room;
  }

  async inviteToRoomRequest(
    relayUrl: string,
    roomId: string,
    hubId: string,
  ): Promise<RoomMember[]> {
    const response = await this.roomRequest<{ members: RoomMember[] }>(
      relayUrl,
      `/api/rooms/${encodeURIComponent(roomId)}/invite`,
      { method: "POST", body: JSON.stringify({ hubId }) },
    );
    this.cacheRoomMembers(roomId, response.members);
    return response.members;
  }

  async getRoomMembersRequest(relayUrl: string, roomId: string): Promise<RoomMember[]> {
    const room = await this.getRoomRequest(relayUrl, roomId);
    return room.members;
  }

  async getRoomRequest(relayUrl: string, roomId: string): Promise<RoomInfo> {
    const room = await this.roomRequest<RoomInfo>(
      relayUrl,
      `/api/rooms/${encodeURIComponent(roomId)}`,
    );
    this.cacheRoomMembers(roomId, room.members);
    return room;
  }

  cachePeerPublicKey(hubId: string, publicKey: string): void {
    if (hubId && publicKey) this.peerPublicKeys.set(hubId, publicKey);
  }

  getPeerPublicKey(hubId: string): string | undefined {
    return this.peerPublicKeys.get(hubId);
  }

  getOnlineRoomMembers(roomId: string): RoomMember[] {
    return (this.roomMembers.get(roomId) ?? [])
      .filter(({ online }) => online)
      .map((member) => ({ ...member }));
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.connectionGeneration += 1;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.rejectPendingRoomCas(new Error("Relay disconnected before Room CAS completed"));
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState !== WebSocket.CLOSED) socket.close(1000, "Hub disconnected");
    this.setState("disconnected");
  }

  onMessage(callback: MessageListener): () => void {
    this.messageListeners.add(callback);
    return () => this.messageListeners.delete(callback);
  }

  onPresence(callback: PresenceListener): () => void {
    this.presenceListeners.add(callback);
    return () => this.presenceListeners.delete(callback);
  }

  onOfflineMessages(callback: OfflineMessagesListener): () => void {
    this.offlineListeners.add(callback);
    return () => this.offlineListeners.delete(callback);
  }

  onStateChange(callback: StateListener): () => void {
    this.stateListeners.add(callback);
    return () => this.stateListeners.delete(callback);
  }

  onRoomEvent(callback: RoomEventListener): () => void {
    this.roomEventListeners.add(callback);
    return () => this.roomEventListeners.delete(callback);
  }

  onRoomMembers(callback: RoomMembersListener): () => void {
    this.roomMembersListeners.add(callback);
    return () => this.roomMembersListeners.delete(callback);
  }

  private openSocket(reconnecting: boolean): Promise<void> {
    const url = this.url;
    const hubId = this.hubId;
    const token = this.token;
    if (!url || !hubId || !token) return Promise.reject(new Error("Relay connection is not configured"));

    const previous = this.socket;
    if (previous && previous.readyState !== WebSocket.CLOSED) previous.close(1000, "Connection replaced");
    this.stopHeartbeat();
    const generation = ++this.connectionGeneration;
    this.setState(reconnecting ? "reconnecting" : "connecting");

    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;
      let registered = false;
      let settled = false;

      socket.on("open", () => {
        if (generation !== this.connectionGeneration) return;
        const register: RelayClientMessage = { type: "register", hubId, token };
        socket.send(JSON.stringify(register));
      });

      socket.on("message", (data: RawData) => {
        if (generation !== this.connectionGeneration) return;
        const message = this.parseMessage(data);
        if (!message) {
          logger.warn("Ignoring invalid Relay message");
          return;
        }
        if (message.type === "registered") {
          registered = true;
          this.reconnectAttempts = 0;
          this.setState("connected");
          this.startHeartbeat();
          // The Relay protocol pushes offline_messages immediately after this frame.
          if (!settled) {
            settled = true;
            resolve();
          }
          return;
        }
        this.handleMessage(message);
      });

      socket.on("pong", () => this.receivedPong());
      socket.on("error", (error) => {
        logger.warn({ err: error }, "Relay WebSocket error");
        if (generation === this.connectionGeneration) this.setState("error");
      });
      socket.on("close", (code, reason) => {
        if (generation !== this.connectionGeneration) return;
        this.stopHeartbeat();
        this.socket = undefined;
        this.rejectPendingRoomCas(new Error("Relay connection closed before Room CAS completed"));
        if (!settled) {
          settled = true;
          reject(new Error(`Relay connection closed before registration (${code}): ${reason.toString()}`));
        }
        if (this.shouldReconnect) this.scheduleReconnect();
        else this.setState("disconnected");
      });

      socket.on("unexpected-response", (_request, response) => {
        if (!settled) {
          settled = true;
          reject(new Error(`Relay rejected WebSocket upgrade with HTTP ${response.statusCode}`));
        }
      });

      if (registered) resolve();
    });
  }

  private handleMessage(message: RelayServerMessage): void {
    if (message.type === "message") {
      for (const listener of this.messageListeners) listener(message.envelope);
    } else if (message.type === "offline_messages") {
      for (const listener of this.offlineListeners) listener(message.envelopes);
    } else if (message.type === "presence") {
      this.cachePeerPublicKey(message.hubId, message.publicKey ?? message.hubId);
      for (const [roomId, members] of this.roomMembers) {
        if (!members.some(({ hubId }) => hubId === message.hubId)) continue;
        this.roomMembers.set(roomId, members.map((member) =>
          member.hubId === message.hubId ? { ...member, online: message.status === "online" } : member
        ));
      }
      for (const listener of this.presenceListeners) listener(message.hubId, message.status);
    } else if (message.type === "room:event") {
      for (const listener of this.roomEventListeners) {
        listener(message.roomId, message.event, message.hubId);
      }
    } else if (message.type === "room:members") {
      this.cacheRoomMembers(message.roomId, message.members);
      for (const listener of this.roomMembersListeners) listener(message.roomId, message.members);
    } else if (message.type === "room_cas_result") {
      const queue = this.pendingRoomCas.get(message.roomId);
      const pending = queue?.shift();
      if (!pending) return;
      clearTimeout(pending.timer);
      if (queue && queue.length === 0) this.pendingRoomCas.delete(message.roomId);
      pending.resolve({
        accepted: message.accepted,
        revision: message.revision,
        keyEpoch: message.keyEpoch,
      });
    } else if (message.type === "pong") {
      this.receivedPong();
    }
  }

  private cacheRoomMembers(roomId: string, members: RoomMember[]): void {
    this.roomMembers.set(roomId, members.map((member) => ({ ...member })));
    for (const member of members) this.cachePeerPublicKey(member.hubId, member.publicKey);
  }

  private parseMessage(data: RawData): RelayServerMessage | null {
    try {
      const value = JSON.parse(data.toString()) as unknown;
      return typeof value === "object" && value !== null && "type" in value
        ? value as RelayServerMessage
        : null;
    } catch {
      return null;
    }
  }

  private send(message: RelayClientMessage): void {
    if (this.connectionState !== "connected" || this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error("Relay is not connected");
    }
    this.socket.send(JSON.stringify(message));
  }

  private async roomRequest<T>(
    relayUrl: string,
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    if (!this.hubId) throw new Error("Hub identity is not configured");
    if (!this.token) throw new Error("Relay authentication token is not configured");
    const url = new URL(relayUrl);
    if (url.protocol === "ws:") url.protocol = "http:";
    if (url.protocol === "wss:") url.protocol = "https:";
    url.pathname = path;
    url.search = "";
    url.hash = "";
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    headers.set("authorization", `Bearer ${this.token}`);
    const response = await fetch(url, {
      ...init,
      headers,
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `Relay room request failed with HTTP ${response.status}`);
    }
    return response.json() as Promise<T>;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.readyState !== WebSocket.OPEN) return;
      this.socket.send(JSON.stringify({ type: "ping" } satisfies RelayClientMessage));
      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pongTimer = setTimeout(() => {
        logger.warn("Relay pong timeout; reconnecting");
        this.socket?.terminate();
      }, PONG_TIMEOUT_MS);
      this.pongTimer.unref();
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref();
  }

  private receivedPong(): void {
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pongTimer = undefined;
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.heartbeatTimer = undefined;
    this.pongTimer = undefined;
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    this.setState("reconnecting");
    const delay = Math.min(1_000 * 2 ** this.reconnectAttempts, MAX_RECONNECT_DELAY_MS);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.openSocket(true).catch((error: unknown) => {
        logger.warn({ err: error }, "Relay reconnect attempt failed");
      });
    }, delay);
    this.reconnectTimer.unref();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private setState(state: HubConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    for (const listener of this.stateListeners) listener(state);
  }

  private removePendingRoomCas(roomId: string, pending: PendingRoomCas): void {
    const queue = this.pendingRoomCas.get(roomId);
    if (!queue) return;
    const index = queue.indexOf(pending);
    if (index >= 0) queue.splice(index, 1);
    if (queue && queue.length === 0) this.pendingRoomCas.delete(roomId);
  }

  private rejectPendingRoomCas(error: Error): void {
    for (const queue of this.pendingRoomCas.values()) {
      for (const pending of queue) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
    }
    this.pendingRoomCas.clear();
  }
}
