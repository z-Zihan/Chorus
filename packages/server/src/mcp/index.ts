import type { AgentAdapter, ConversationContext, StreamChunk } from "@chorus/shared";
import { BaseAdapter } from "../agent/adapter.js";
import { MCPClient } from "./client.js";

export { MCPClient } from "./client.js";
export type { MCPTool } from "./client.js";

export interface MCPAdapterConfig {
  id: string;
  name: string;
  description?: string;
  config: {
    command: string;
    args?: string[];
    tool?: string;
    toolArgs?: Record<string, unknown>;
  };
}

class MCPToolAdapter extends BaseAdapter {
  readonly id: string;
  readonly name: string;
  override readonly description: string;
  private readonly client = new MCPClient();

  constructor(private readonly definition: MCPAdapterConfig) {
    super();
    this.id = definition.id;
    this.name = definition.name;
    this.description = definition.description ?? "MCP tool agent";
  }

  async init(config: Record<string, unknown>): Promise<void> {
    const merged = { ...this.definition.config, ...config };
    const command = typeof merged.command === "string" ? merged.command.trim() : "";
    if (!command) throw new Error("MCP adapter command is missing");
    this.config = merged;
    await this.client.connect(command, Array.isArray(merged.args) ? merged.args.map(String) : []);
    this.status = "online";
  }

  async *handleMessage(message: string, context: ConversationContext): AsyncGenerator<StreamChunk> {
    const configuredTool = typeof this.config.tool === "string" ? this.config.tool : "";
    const tool = configuredTool || (await this.client.listTools())[0]?.name;
    if (!tool) throw new Error("MCP server did not expose any tools");
    const configuredArgs = isRecord(this.config.toolArgs) ? this.config.toolArgs : {};
    const result = await this.client.callTool(tool, {
      ...configuredArgs,
      message,
      conversationId: context.conversationId,
    });
    const content = mcpResultText(result);
    if (content) yield { type: "text", content };
    yield { type: "done", content: "" };
  }

  override async healthCheck(): Promise<boolean> {
    return this.client.isConnected;
  }

  destroy(): void {
    this.client.disconnect();
  }
}

export function createMCPAdapter(config: MCPAdapterConfig): AgentAdapter {
  return new MCPToolAdapter(config);
}

function mcpResultText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return value === undefined ? "" : JSON.stringify(value);
  if (Array.isArray(value.content)) {
    return value.content.map((item) => {
      if (isRecord(item) && typeof item.text === "string") return item.text;
      return typeof item === "string" ? item : "";
    }).join("");
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
