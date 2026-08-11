import type { Agent } from "@chorus/shared";
import { describe, expect, it } from "vitest";
import { StandardAdapterMapper } from "./standard-adapters.js";

const agent: Agent = {
  id: "research-agent",
  name: "Research Agent",
  description: "Finds and summarizes sources",
  type: "mock",
  status: "online",
  disabled: false,
  capabilities: ["research", "summarize"],
  createdAt: 1,
  updatedAt: 1,
};

describe("StandardAdapterMapper", () => {
  const mapper = new StandardAdapterMapper();

  it("converts an Agent to a Google A2A Agent Card", () => {
    expect(mapper.toAgentCard(agent, "https://chorus.example/")).toEqual({
      name: "Research Agent",
      description: "Finds and summarizes sources",
      url: "https://chorus.example/api/agents/research-agent",
      version: "1.0.0",
      capabilities: {
        streaming: true,
        pushNotifications: false,
        stateTransition: false,
      },
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain", "text/markdown"],
      skills: [
        {
          id: "research",
          name: "research",
          description: "Capability: research",
          tags: ["research"],
        },
        {
          id: "summarize",
          name: "summarize",
          description: "Capability: summarize",
          tags: ["summarize"],
        },
      ],
    });
  });

  it("converts an Agent to an MCP Tool", () => {
    expect(mapper.toMCPTool(agent)).toEqual({
      name: "research-agent",
      description: "Finds and summarizes sources",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", description: "Message to send to the agent" },
          conversationId: { type: "string", description: "Conversation ID" },
        },
        required: ["message"],
      },
    });
  });

  it("converts an Agent to an ACP service descriptor", () => {
    expect(mapper.toACPService(agent, "https://chorus.example/")).toEqual({
      serviceId: "research-agent",
      serviceName: "Research Agent",
      serviceDescription: "Finds and summarizes sources",
      serviceEndpoint: "https://chorus.example/api/conversations",
      serviceType: "agent-communication",
      protocolVersion: "1.0",
      capabilities: ["research", "summarize"],
      status: "online",
    });
  });
});
