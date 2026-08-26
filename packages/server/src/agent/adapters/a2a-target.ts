/**
 * Agents are addressed by id in prompts, but models frequently answer with the
 * display name they saw in the conversation. Resolve either form to the agent id.
 */
export function resolveA2ATarget(
  target: string,
  callableAgentIds: string[],
  agentNames?: Record<string, string>,
): string | undefined {
  const wanted = target.trim().toLocaleLowerCase();
  if (!wanted) return undefined;
  const byId = callableAgentIds.find((id) => id.toLocaleLowerCase() === wanted);
  if (byId) return byId;
  return callableAgentIds.find((id) => {
    const name = agentNames?.[id];
    return name !== undefined && name.trim().toLocaleLowerCase() === wanted;
  });
}
