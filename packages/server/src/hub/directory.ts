import type { Agent, AgentConfig, DirectoryManifest } from "@agentlink/shared";
import type { AgentRegistry } from "../agent/registry.js";
import { getUserKey } from "../credential-store.js";
import type { Repository } from "../db/repository.js";
import { signData, verifySignature } from "../identity/user-keys.js";
import { logger } from "../utils/logger.js";
import { TrustStore } from "./trust-store.js";

const DIRECTORY_TTL_MS = 10 * 60 * 1000;

export interface DirectoryAudience {
  trusted: boolean;
  sharedRoom: boolean;
}

const TRUSTED_AUDIENCE: DirectoryAudience = { trusted: true, sharedRoom: false };

export class DirectoryService {
  private directoryVersion = 0;
  private readonly remoteDirectories = new Map<string, DirectoryManifest>();

  constructor(
    private readonly repository: Repository,
    private readonly registry: AgentRegistry,
    private readonly localHubId = "",
    private readonly trustStore = new TrustStore(),
  ) {}

  /** Build an unsigned directory manifest containing only agents visible to the audience. */
  buildLocalDirectory(audience: DirectoryAudience = TRUSTED_AUDIENCE): DirectoryManifest | null {
    const localUser = this.repository.getUser("usr_local");
    if (!localUser?.publicKey) return null;

    const issuedAt = Date.now();
    const agents = this.registry
      .list()
      .map((agent) => ({ agent, visibility: agentVisibility(agent) }))
      .filter(({ visibility }) => isVisibleTo(visibility, audience))
      .map(({ agent, visibility }) => ({
        id: agent.id,
        name: agent.name,
        description: agent.description || undefined,
        type: agent.type,
        capabilities: agent.capabilities ?? [],
        status: agent.status,
        visibility,
      }));

    const manifest: Omit<DirectoryManifest, "signature"> = {
      schemaVersion: 1,
      directoryVersion: ++this.directoryVersion,
      issuedAt,
      expiresAt: issuedAt + DIRECTORY_TTL_MS,
      user: {
        id: localUser.id,
        name: localUser.name,
        avatar: localUser.avatar,
        hubId: this.localHubId || localUser.hubId || "",
        publicKey: localUser.publicKey,
      },
      agents,
      revokedAgentIds: [],
    };

    return { ...manifest, signature: "" };
  }

  /** Read the User private key from credential storage and build a signed manifest. */
  async buildSignedLocalDirectory(
    audience: DirectoryAudience = TRUSTED_AUDIENCE,
  ): Promise<DirectoryManifest | null> {
    const manifest = this.buildLocalDirectory(audience);
    if (!manifest) return null;
    const keyPair = await getUserKey();
    if (!keyPair || keyPair.publicKey !== manifest.user.publicKey) {
      logger.warn("Unable to sign directory manifest: local User key is unavailable or mismatched");
      return null;
    }
    return this.signManifest(manifest, keyPair.privateKey);
  }

  /** Sign a manifest with the User private key. */
  signManifest(manifest: DirectoryManifest, privateKey: string): DirectoryManifest {
    const { signature: _signature, ...unsigned } = manifest;
    return { ...unsigned, signature: signData(privateKey, JSON.stringify(unsigned)) };
  }

  /** Verify a received manifest's User signature. */
  verifyManifest(manifest: DirectoryManifest): boolean {
    const { signature, ...unsigned } = manifest;
    if (!manifest.user.publicKey || !signature) return false;
    return verifySignature(manifest.user.publicKey, JSON.stringify(unsigned), signature);
  }

  isExpired(manifest: DirectoryManifest): boolean {
    return Date.now() > manifest.expiresAt;
  }

  isNewer(manifest: DirectoryManifest, current?: DirectoryManifest): boolean {
    return !current || manifest.directoryVersion > current.directoryVersion;
  }

  getRemoteDirectory(hubId: string): DirectoryManifest | undefined {
    return this.remoteDirectories.get(hubId);
  }

  /** Keep a remote Hub's historical identities, but make them unavailable until refreshed. */
  markStaleAgents(hubId: string): void {
    this.repository.setRemoteAgentsDisabled(hubId, true);
    this.registry.markRemoteAgentsStale(hubId);
  }

  /** Upsert a remote User and register its visible agents as one directory update. */
  applyRemoteDirectory(manifest: DirectoryManifest): void {
    const hubId = manifest.user.hubId;
    if (!this.trustStore.isTrusted(hubId)) {
      logger.warn({ hubId }, "Ignoring directory from an untrusted Hub");
      return;
    }
    if (this.trustStore.detectKeyChange(hubId, manifest.user.publicKey)) {
      logger.warn({ hubId }, "Remote User public key changed; Hub must be paired again");
      return;
    }

    const transaction = this.repository.context.sqlite.transaction(() => {
      this.repository.upsertRemoteUser({
        id: manifest.user.id,
        name: manifest.user.name,
        avatar: manifest.user.avatar,
        hubId: manifest.user.hubId,
        publicKey: manifest.user.publicKey,
        kind: "remote",
        createdAt: manifest.issuedAt,
        updatedAt: manifest.issuedAt,
        lastSeenAt: Date.now(),
      });

      this.markStaleAgents(manifest.user.hubId);
      for (const agent of manifest.agents) {
        const remoteId = this.registry.getRemoteAgentId(manifest.user.hubId, agent.id);
        this.repository.upsertAgent(
          {
            id: remoteId,
            name: agent.name,
            description: agent.description ?? "",
            type: agent.type as AgentConfig["type"],
            config: {},
            source: "user",
            managed: false,
            customizedFields: [],
            disabled: false,
            capabilities: agent.capabilities,
            ownerId: manifest.user.id,
            ownerType: "remote",
            stale: false,
            homeHubId: manifest.user.hubId,
          },
          null,
        );
        this.registry.registerRemoteAgent(agent.id, manifest.user.hubId, agent.name, agent.status);
      }
      for (const agentId of manifest.revokedAgentIds) {
        this.registry.removeRemoteAgent(manifest.user.hubId, agentId);
        this.repository.deleteAgent(this.registry.getRemoteAgentId(manifest.user.hubId, agentId));
        logger.info({ agentId, hubId: manifest.user.hubId }, "Revoked remote directory agent");
      }
    });
    transaction();
    this.trustStore.recordSeen(hubId, {
      userId: manifest.user.id,
      userName: manifest.user.name,
      userPublicKey: manifest.user.publicKey,
    });
    this.remoteDirectories.set(hubId, manifest);
  }
}

type DirectoryVisibility = DirectoryManifest["agents"][number]["visibility"];

function agentVisibility(agent: Agent): DirectoryVisibility {
  const visibility = (agent as Agent & { visibility?: unknown }).visibility;
  return visibility === "public" || visibility === "room" || visibility === "trusted"
    ? visibility
    : "trusted";
}

function isVisibleTo(visibility: DirectoryVisibility, audience: DirectoryAudience): boolean {
  if (visibility === "public") return true;
  if (visibility === "room") return audience.sharedRoom;
  return audience.trusted;
}
