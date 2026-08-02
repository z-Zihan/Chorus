import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export class MCPClient {
  private child?: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private stdoutBuffer = "";

  get isConnected(): boolean {
    return Boolean(this.child && this.child.exitCode === null && !this.child.killed);
  }

  async connect(command: string, args: string[] = []): Promise<void> {
    if (this.child) this.disconnect();
    this.child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.consumeOutput(chunk));
    this.child.once("error", (error) => this.failPending(error));
    this.child.once("close", () => {
      this.failPending(new Error("MCP server disconnected"));
      this.child = undefined;
    });

    try {
      await this.request("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "agentlink", version: "0.3.0" },
      });
      this.notify("notifications/initialized", {});
      // TODO: Negotiate all MCP protocol versions and server capabilities through the official SDK.
    } catch (error) {
      this.disconnect();
      throw error;
    }
  }

  async listTools(): Promise<MCPTool[]> {
    const result = await this.request("tools/list", {}) as { tools?: MCPTool[] };
    return Array.isArray(result.tools) ? result.tools : [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.request("tools/call", { name, arguments: args });
  }

  disconnect(): void {
    const child = this.child;
    this.child = undefined;
    this.failPending(new Error("MCP client disconnected"));
    if (child && child.exitCode === null && !child.killed) child.kill("SIGTERM");
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const child = this.child;
    if (!child || !this.isConnected) return Promise.reject(new Error("MCP client is not connected"));
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, 10_000);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    if (!this.child || !this.isConnected) return;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  private consumeOutput(chunk: string): void {
    this.stdoutBuffer += chunk;
    const lines = this.stdoutBuffer.split(/\r?\n/u);
    this.stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let response: JsonRpcResponse;
      try {
        response = JSON.parse(line) as JsonRpcResponse;
      } catch {
        continue;
      }
      if (typeof response.id !== "number") continue;
      const pending = this.pending.get(response.id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(response.id);
      if (response.error) {
        pending.reject(new Error(response.error.message ?? `MCP error ${response.error.code ?? "unknown"}`));
      } else {
        pending.resolve(response.result);
      }
    }
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
