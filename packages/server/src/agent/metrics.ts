export interface AgentMetrics {
  totalCalls: number;
  successRate: number;
  avgLatencyMs: number;
  lastCallAt: number | null;
}

interface MetricsState {
  totalCalls: number;
  successfulCalls: number;
  totalLatencyMs: number;
  lastCallAt: number;
}

const EMPTY_METRICS: AgentMetrics = {
  totalCalls: 0,
  successRate: 0,
  avgLatencyMs: 0,
  lastCallAt: null,
};

export class AdapterMetrics {
  private readonly metrics = new Map<string, MetricsState>();

  recordInvocation(agentId: string, durationMs: number, success: boolean): void {
    const current = this.metrics.get(agentId) ?? {
      totalCalls: 0,
      successfulCalls: 0,
      totalLatencyMs: 0,
      lastCallAt: 0,
    };
    current.totalCalls += 1;
    if (success) current.successfulCalls += 1;
    current.totalLatencyMs += Math.max(0, durationMs);
    current.lastCallAt = Date.now();
    this.metrics.set(agentId, current);
  }

  getMetrics(agentId: string): AgentMetrics {
    const state = this.metrics.get(agentId);
    if (!state) return { ...EMPTY_METRICS };
    return {
      totalCalls: state.totalCalls,
      successRate: state.successfulCalls / state.totalCalls,
      avgLatencyMs: state.totalLatencyMs / state.totalCalls,
      lastCallAt: state.lastCallAt,
    };
  }

  getAllMetrics(): Record<string, AgentMetrics> {
    return Object.fromEntries(
      [...this.metrics.keys()].map((agentId) => [agentId, this.getMetrics(agentId)]),
    );
  }
}
