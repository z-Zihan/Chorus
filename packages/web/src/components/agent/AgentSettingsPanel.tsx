import { useEffect, useState } from "react";
import type { Agent } from "@agentlink/shared";
import { AgentAvatar } from "@/components/agent/AgentAvatar";
import { PasswordInput } from "@/components/common/PasswordInput";
import { STATUS_COLORS, STATUS_LABELS } from "@/constants/agent";
import { useAgentStore } from "@/store/agentStore";

type AgentWithConfig = Agent & { config?: Record<string, unknown> };

function configText(agent: Agent, key: string): string {
  const value = (agent as AgentWithConfig).config?.[key];
  return typeof value === "string" ? value : "";
}

export function AgentSettingsPanel() {
  const agents = useAgentStore((state) => state.agents);
  const selectedAgentId = useAgentStore((state) => state.selectedAgentId);
  const updateAgent = useAgentStore((state) => state.updateAgent);
  const clearSelectedAgent = useAgentStore(
    (state) => state.clearSelectedAgent
  );
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const [displayedAgent, setDisplayedAgent] = useState<Agent | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [initialSystemPrompt, setInitialSystemPrompt] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedAgent) return;
    const prompt = configText(selectedAgent, "systemPrompt");
    setDisplayedAgent(selectedAgent);
    setName(selectedAgent.name);
    setDescription(selectedAgent.description);
    setSystemPrompt(prompt);
    setInitialSystemPrompt(prompt);
    setModel(selectedAgent.model ?? configText(selectedAgent, "model"));
    setApiKey("");
    setError(null);
  }, [selectedAgent]);

  useEffect(() => {
    if (!selectedAgentId) {
      setIsVisible(false);
      return;
    }

    const frame = window.requestAnimationFrame(() => setIsVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, [selectedAgentId]);

  useEffect(() => {
    if (!selectedAgentId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) clearSelectedAgent();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearSelectedAgent, isSaving, selectedAgentId]);

  if (!displayedAgent) return null;

  const isOpen = Boolean(selectedAgentId) && isVisible;

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Agent 名称不能为空");
      return;
    }

    setIsSaving(true);
    setError(null);

    const config: Record<string, unknown> = {};
    if (model !== (displayedAgent.model ?? "")) config.model = model;
    if (systemPrompt !== initialSystemPrompt) config.systemPrompt = systemPrompt;
    if (apiKey) config.apiKey = apiKey;

    try {
      await updateAgent(displayedAgent.id, {
        name: trimmedName,
        description: description.trim(),
        ...(Object.keys(config).length > 0 ? { config } : {}),
      });
      clearSelectedAgent();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "保存失败，请稍后重试"
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      aria-hidden={!isOpen}
      className={`fixed inset-0 z-50 transition ${
        isOpen ? "pointer-events-auto" : "pointer-events-none"
      }`}
    >
      <button
        type="button"
        aria-label="关闭 Agent 设置"
        onClick={clearSelectedAgent}
        disabled={isSaving}
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-200 ${
          isOpen ? "opacity-100" : "opacity-0"
        }`}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-settings-title"
        className={`absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-gray-800 bg-gray-900 shadow-2xl transition-transform duration-200 ease-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
          <h2 id="agent-settings-title" className="font-semibold text-gray-100">
            Agent 设置
          </h2>
          <button
            type="button"
            onClick={clearSelectedAgent}
            disabled={isSaving}
            aria-label="关闭"
            className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200 disabled:opacity-50"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-6">
          <div className="mb-6 flex items-center gap-4 rounded-xl border border-gray-800 bg-gray-950/60 p-4">
            <AgentAvatar
              name={displayedAgent.name}
              src={displayedAgent.avatar}
              size="lg"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-gray-100">
                {displayedAgent.name}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                <span className="rounded bg-gray-800 px-2 py-0.5 uppercase text-gray-400">
                  {displayedAgent.type}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${STATUS_COLORS[displayedAgent.status]}`} />
                  {STATUS_LABELS[displayedAgent.status]}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-300">名称</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-gray-100 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-300">描述</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                maxLength={500}
                className="w-full resize-none rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-gray-100 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-300">模型</span>
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="例如 gpt-4o-mini"
                className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-gray-100 outline-none transition placeholder:text-gray-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-300">系统提示词</span>
              <textarea
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                rows={6}
                placeholder="输入 Agent 的行为和角色说明"
                className="w-full resize-y rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm leading-6 text-gray-100 outline-none transition placeholder:text-gray-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
            </label>

            <div>
              <PasswordInput
                label="API Key"
                value={apiKey}
                onChange={setApiKey}
                placeholder="留空以保留现有 API Key"
              />
              <p className="mt-2 text-xs text-gray-600">
                出于安全考虑，已保存的密钥不会显示。
              </p>
            </div>

            {error && (
              <div role="alert" className="rounded-lg border border-red-900 bg-red-950/50 px-3 py-2.5 text-sm text-red-300">
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-800 bg-gray-900 px-5 py-4">
          <button
            type="button"
            onClick={clearSelectedAgent}
            disabled={isSaving}
            className="rounded-lg border border-gray-700 px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving}
            className="min-w-24 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-60"
          >
            {isSaving ? "保存中..." : "保存"}
          </button>
        </div>
      </aside>
    </div>
  );
}
