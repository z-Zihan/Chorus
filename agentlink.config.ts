import type { AppConfig } from "@agentlink/shared";

export default {
  port: 3210,
  dbPath: "./data/agentlink.db",
  cors: {
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
  },
  auth: { enabled: false, tokens: {} },
  history: { maxMessages: 20, maxTokens: 8_000 },
  agents: [
    {
      id: "claude",
      name: "Claude Code",
      description: "Claude Code CLI 本地 Agent",
      type: "cli",
      config: {
        model: "claude-sonnet-4-20250514",
        command: "claude",
        args: ["-p", "--output-format", "stream-json", "--verbose", "--no-session-persistence"],
        input: "argument",
        output: "jsonl",
      },
    },
  ],
} satisfies AppConfig;
