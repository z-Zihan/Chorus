import { A2AThread } from "@/components/message/A2AThread";
import { MessageBubble } from "@/components/message/MessageBubble";
import type { A2AThreadState, Message } from "@/store/chatStore";
import { useTranslation } from "react-i18next";

const now = Date.now();
const messages: Message[] = [
  {
    id: "fixture-sending",
    conversationId: "fixture",
    fromType: "user",
    fromId: "user",
    content: "请让另一台设备上的 Agent 汇总这份结果。",
    timestamp: now - 3_000,
    status: "sending",
  },
  {
    id: "fixture-failed",
    conversationId: "fixture",
    fromType: "user",
    fromId: "user",
    content: "这条消息在本地连接中断后未能发送。",
    timestamp: now - 2_000,
    status: "error",
  },
  {
    id: "fixture-partial",
    conversationId: "fixture",
    fromType: "agent",
    fromId: "local-agent",
    content: "已经完成前两部分，最后一段在流式连接中断前未返回。",
    timestamp: now - 1_000,
    status: "partial",
  },
];

const thread: A2AThreadState = {
  threadId: "fixture-thread",
  conversationId: "fixture",
  from: "local-agent",
  to: "remote-agent",
  message: "跨设备核对结果",
  result: "",
  status: "running",
  startedAt: now,
  delivery: {
    transport: "delivered",
    execution: "accepted",
  },
};

export function MessageStatusFixture() {
  const { t } = useTranslation("chat");
  return (
    <main className="min-h-screen bg-[var(--bg-base)] px-4 py-8 text-[var(--text-primary)] sm:px-8">
      <section className="mx-auto max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--accent-hover)]">
          {t("statusFixture.eyebrow")}
        </p>
        <h1 className="mt-2 text-2xl font-semibold">{t("statusFixture.title")}</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--text-secondary)]">
          {t("statusFixture.description")}
        </p>
        <div className="mt-8 space-y-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-4 sm:p-6">
          <MessageBubble message={messages[0]} />
          <MessageBubble message={messages[1]} />
          <MessageBubble message={messages[2]} agentName="Local Agent" />
          <A2AThread messages={[]} thread={thread} />
        </div>
      </section>
    </main>
  );
}
