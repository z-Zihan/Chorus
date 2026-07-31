import type { AppConfig } from "@agentlink/shared";

export default {
  port: 3210,
  dbPath: "./data/agentlink.db",
  cors: {
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
  },
  auth: { enabled: false },
  history: { maxMessages: 20, maxTokens: 8_000 },
  agents: [
    {
      id: "link",
      name: "Link",
      description: "AgentLink 本地协作助手",
      type: "mock",
      config: { model: "AgentLink Mock", delayMs: 24 },
    },
  ],
} satisfies AppConfig;
