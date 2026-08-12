import { useCallback, useEffect, useState } from "react";
import type { Agent, AgentVisibility } from "@chorus/shared";
import { useTranslation } from "react-i18next";
import { useAgentStore } from "@/store/agentStore";

type AgentWithConfig = Agent & { config?: Record<string, unknown> };

export interface AgentSettingsFields {
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  apiKey: string;
  visibility: AgentVisibility;
}

function configText(agent: Agent, key: string): string {
  const value = (agent as AgentWithConfig).config?.[key];
  return typeof value === "string" ? value : "";
}

const EMPTY_FIELDS: AgentSettingsFields = {
  name: "",
  description: "",
  model: "",
  systemPrompt: "",
  apiKey: "",
  visibility: "private",
};

export function useAgentSettings(agentId: string | null) {
  const { t } = useTranslation(["settings", "errors"]);
  const agent = useAgentStore((state) => state.agents.find((item) => item.id === agentId));
  const updateAgent = useAgentStore((state) => state.updateAgent);
  const clearSelectedAgent = useAgentStore((state) => state.clearSelectedAgent);
  const [fields, setFields] = useState<AgentSettingsFields>(EMPTY_FIELDS);
  const [initialSystemPrompt, setInitialSystemPrompt] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agent) return;
    const systemPrompt = configText(agent, "systemPrompt");
    setFields({
      name: agent.name,
      description: agent.description,
      model: agent.model ?? configText(agent, "model"),
      systemPrompt,
      apiKey: "",
      visibility: agent.visibility ?? "private",
    });
    setInitialSystemPrompt(systemPrompt);
    setError(null);
  }, [agent]);

  const setField = useCallback(
    <K extends keyof AgentSettingsFields>(field: K, value: AgentSettingsFields[K]) => {
      setFields((current) => ({ ...current, [field]: value }));
    },
    [],
  );

  const cancel = useCallback(() => {
    clearSelectedAgent();
  }, [clearSelectedAgent]);

  const save = useCallback(async () => {
    if (!agent) return;
    const trimmedName = fields.name.trim();
    if (!trimmedName) {
      setError(t("settings:errors.nameRequired"));
      return;
    }

    setIsSaving(true);
    setError(null);
    const config: Record<string, unknown> = {};
    if (fields.model !== (agent.model ?? "")) config.model = fields.model;
    if (fields.systemPrompt !== initialSystemPrompt) config.systemPrompt = fields.systemPrompt;
    if (fields.apiKey) config.apiKey = fields.apiKey;

    try {
      await updateAgent(agent.id, {
        name: trimmedName,
        description: fields.description.trim(),
        visibility: fields.visibility,
        ...(Object.keys(config).length > 0 ? { config } : {}),
      });
      clearSelectedAgent();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("errors:saveFailed"));
    } finally {
      setIsSaving(false);
    }
  }, [agent, clearSelectedAgent, fields, initialSystemPrompt, t, updateAgent]);

  return { fields, setField, save, cancel, isSaving, error };
}
