export interface RelaySocket {
  readonly readyState: number;
  send(data: string): void;
  ping(): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  on(event: "message", listener: (data: { toString(): string }) => void): this;
  on(event: "close", listener: () => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "pong", listener: () => void): this;
}

export const OPEN_SOCKET_STATE = 1;

export function sendJson(socket: RelaySocket, value: unknown): boolean {
  if (socket.readyState !== OPEN_SOCKET_STATE) return false;
  socket.send(JSON.stringify(value));
  return true;
}
