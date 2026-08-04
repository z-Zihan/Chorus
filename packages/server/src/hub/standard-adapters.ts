import type { Agent } from "@agentlink/shared";

/**
 * Map AgentLink identity and capabilities to standard protocols.
 *
 * Google A2A: https://github.com/google/agent2agent
 * MCP: Model Context Protocol
 * ACP: Agent Communication Protocol
 */

export interface StandardAgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransition: boolean;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
  }>;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ACPService {
  serviceId: string;
  serviceName: string;
  serviceDescription: string;
  serviceEndpoint: string;
  serviceType: "agent-communication";
  protocolVersion: "1.0";
  capabilities: string[];
  status: Agent["status"];
}

export class StandardAdapterMapper {
  /** Convert AgentLink Agent to Google A2A Agent Card. */
  toAgentCard(agent: Agent, baseUrl: string): StandardAgentCard {
    return {
      name: agent.name,
      description: agent.description,
      url: `${normalizedBaseUrl(baseUrl)}/api/agents/${agent.id}`,
      version: "1.0.0",
      capabilities: {
        streaming: true,
        pushNotifications: false,
        stateTransition: false,
      },
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain", "text/markdown"],
      skills: (agent.capabilities ?? []).map((capability) => ({
        id: capability,
        name: capability,
        description: `Capability: ${capability}`,
        tags: [capability],
      })),
    };
  }

  /** Convert AgentLink Agent to an MCP Tool definition. */
  toMCPTool(agent: Agent): MCPTool {
    return {
      name: agent.id,
      description: agent.description || agent.name,
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", description: "Message to send to the agent" },
          conversationId: { type: "string", description: "Conversation ID" },
        },
        required: ["message"],
      },
    };
  }

  /** Convert AgentLink Agent to an ACP service descriptor. */
  toACPService(agent: Agent, baseUrl: string): ACPService {
    return {
      serviceId: agent.id,
      serviceName: agent.name,
      serviceDescription: agent.description,
      serviceEndpoint: `${normalizedBaseUrl(baseUrl)}/api/conversations`,
      serviceType: "agent-communication",
      protocolVersion: "1.0",
      capabilities: agent.capabilities ?? [],
      status: agent.status,
    };
  }
}

function normalizedBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}
