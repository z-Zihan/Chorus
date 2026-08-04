export type UserKind = "local" | "remote";

export interface User {
  id: string;
  name: string;
  avatar?: string;
  hubId?: string;
  publicKey?: string;
  kind: UserKind;
  createdAt: number;
  updatedAt: number;
  lastSeenAt?: number;
}

export interface UserHubBinding {
  userId: string;
  userPublicKey: string;
  hubId: string;
  issuedAt: number;
  expiresAt: number;
  userSignature: string;
  hubSignature: string;
}
