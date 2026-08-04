import type { A2APolicy } from "@agentlink/shared";
import type { Repository } from "../db/repository";

export type A2APermissionMode = A2APolicy;

export const DEFAULT_A2A_PERMISSION: A2APermissionMode = "auto";

export class A2APermissions {
  constructor(private readonly repository: Repository) {}

  getPermission(conversationId: string): A2APermissionMode {
    const value = this.repository.getConversation(conversationId)?.a2aPolicy;
    return isPermissionMode(value) ? value : DEFAULT_A2A_PERMISSION;
  }

  setPermission(conversationId: string, mode: A2APermissionMode): void {
    this.repository.updateConversation(conversationId, { a2aPolicy: mode });
  }
}

function isPermissionMode(value: string | undefined): value is A2APermissionMode {
  return value === "auto" || value === "confirm" || value === "deny";
}
