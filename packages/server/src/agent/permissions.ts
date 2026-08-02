import type { Repository } from "../db/repository";

export type A2APermissionMode = "auto" | "confirm" | "deny";

export const DEFAULT_A2A_PERMISSION: A2APermissionMode = "auto";

const SETTING_PREFIX = "a2a-permission:";

export class A2APermissions {
  constructor(private readonly repository: Repository) {}

  getPermission(conversationId: string): A2APermissionMode {
    const value = this.repository.getSetting(`${SETTING_PREFIX}${conversationId}`);
    return isPermissionMode(value) ? value : DEFAULT_A2A_PERMISSION;
  }

  setPermission(conversationId: string, mode: A2APermissionMode): void {
    this.repository.setSetting(`${SETTING_PREFIX}${conversationId}`, mode);
  }
}

function isPermissionMode(value: string | undefined): value is A2APermissionMode {
  return value === "auto" || value === "confirm" || value === "deny";
}
