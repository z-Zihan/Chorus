import type { AppConfig } from "@chorus/shared";

export default {
  port: 3210,
  dbPath: "./data/chorus.db",
  cors: {
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
  },
  auth: { enabled: false, tokens: {} },
  history: { maxMessages: 20, maxTokens: 8_000 },
  agents: [],
} satisfies AppConfig;
