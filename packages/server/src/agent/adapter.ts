import type { AgentAdapter, AgentStatus, ConversationContext, StreamChunk } from "@agentlink/shared";

export abstract class BaseAdapter implements AgentAdapter {
  abstract readonly id: string;
  abstract readonly name: string;
  readonly description: string = "";
  readonly avatar?: string;
  config: Record<string, unknown> = {};
  protected status: AgentStatus = "offline";

  abstract init(config: Record<string, unknown>): Promise<void>;
  abstract handleMessage(
    message: string,
    context: ConversationContext,
  ): AsyncGenerator<StreamChunk>;

  getStatus(): AgentStatus {
    return this.status;
  }

  setRuntimeStatus(status: AgentStatus): void {
    this.status = status;
  }
}

export function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown agent error";
}
