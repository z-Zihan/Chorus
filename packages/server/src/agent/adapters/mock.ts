import { randomUUID } from "node:crypto";
import type { ConversationContext, StreamChunk } from "@agentlink/shared";
import { BaseAdapter } from "../adapter";

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => {
    clearTimeout(timer);
    reject(new DOMException("Request cancelled", "AbortError"));
  }, { once: true });
});

export class MockAdapter extends BaseAdapter {
  readonly id: string;
  readonly name: string;
  override readonly description: string;

  constructor(id: string, name: string, description = "Local mock agent") {
    super();
    this.id = id;
    this.name = name;
    this.description = description;
  }

  async init(config: Record<string, unknown>): Promise<void> {
    this.config = config;
    this.status = "online";
  }

  async *handleMessage(message: string, context: ConversationContext): AsyncGenerator<StreamChunk> {
    const delay = Number(this.config.delayMs ?? 24);
    yield { type: "thinking", content: "理解问题并规划回复" };
    await sleep(Math.max(0, Math.min(delay * 4, 500)), context.signal);

    if (/审查|review|协作|a2a/i.test(message)) {
      yield* this.mockA2A(message, context, delay);
    } else {
      const reply = buildReply(message);
      for (const token of tokenize(reply)) {
        await sleep(delay, context.signal);
        yield { type: "text", content: token };
      }
    }
    yield { type: "done", content: "" };
  }

  async *handleA2ACall(
    from: string,
    message: string,
    context: ConversationContext,
  ): AsyncGenerator<StreamChunk> {
    yield { type: "thinking", content: `正在处理来自 ${from} 的请求` };
    yield { type: "text", content: `已分析任务：${message.slice(0, 80)}。未发现阻塞项。` };
    yield { type: "done", content: "", metadata: { context: context.conversationId } };
  }

  private async *mockA2A(
    message: string,
    context: ConversationContext,
    delay: number,
  ): AsyncGenerator<StreamChunk> {
    const threadId = randomUUID();
    const intro = "我会并行请代码审查与安全检查两个专用 Agent 给出意见。\n\n";
    for (const token of tokenize(intro)) {
      await sleep(delay, context.signal);
      yield { type: "text", content: token };
    }

    const calls = [
      {
        id: "code-reviewer",
        label: "Code Reviewer",
        result: "发现 3 个改进点：补充输入边界校验、拆分过长函数，并为异常路径增加测试。",
      },
      {
        id: "security-checker",
        label: "Security Checker",
        result: "安全检查完成：未发现高危问题；建议避免在日志中输出密钥，并限制外部 URL。",
      },
    ];

    for (const call of calls) {
      yield {
        type: "tool_call",
        content: `调用 @${call.id}`,
        threadId,
        sourceAgentId: this.id,
        metadata: { to: call.id, label: call.label, request: message, phase: "start" },
      };
      await sleep(Math.max(delay * 8, 180), context.signal);
      yield {
        type: "task_step",
        content: call.result,
        threadId,
        sourceAgentId: call.id,
        metadata: { label: call.label, status: "done", phase: "response" },
      };
    }

    const summary = "\n\n### 汇总结论\n\n共得到 **4 条建议**，当前没有阻塞发布的高危项。优先补上输入校验和异常路径测试。";
    for (const token of tokenize(summary)) {
      await sleep(delay, context.signal);
      yield { type: "text", content: token };
    }
  }
}

function tokenize(text: string): string[] {
  return text.match(/[\s\S]{1,3}/g) ?? [];
}

function buildReply(message: string): string {
  if (/你好|hello|hi\b/i.test(message)) {
    return "你好，我是 **Link**。我已连接本地会话与实时消息通道。\n\n你可以让我解释问题、生成代码示例，或输入“帮我审查这个 PR”查看 A2A 调用链。";
  }
  return `收到你的消息：\n\n> ${message}\n\n这是来自 Mock Adapter 的流式回复。你可以在 \`agentlink.config.ts\` 中切换为 OpenAI Adapter。\n\n\`\`\`ts\nconst status = \"ready\";\nconsole.log(status);\n\`\`\``;
}
