import { useEffect } from "react";
import { MessageList } from "@/components/message/MessageList";
import { useChatStore, type Message } from "@/store/chatStore";
import i18n from "@/i18n";

const preservedMessage: Message = {
  id: "preserved-message",
  conversationId: "load-error-fixture",
  fromType: "agent",
  fromId: "fixture-agent",
  content: "The last successfully loaded message remains available.",
  timestamp: Date.now(),
  status: "done",
};

export function LoadErrorFixture() {
  useEffect(() => {
    const preserveMessages = new URLSearchParams(window.location.search).has("preserved");
    useChatStore.setState({
      currentConversationId: "load-error-fixture",
      messages: preserveMessages ? [preservedMessage] : [],
      a2aThreads: {},
      isLoadingMessages: false,
      messagesError: i18n.t("chat:messageLoadFailed"),
    });
  }, []);

  return (
    <main className="h-screen bg-[var(--bg-base)] text-[var(--text-primary)]">
      <MessageList />
    </main>
  );
}
