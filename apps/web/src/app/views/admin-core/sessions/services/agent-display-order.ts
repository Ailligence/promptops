type OrderedAgent = { id: string; role: string; title: string; createdAt?: string };

/** Runtime IDs change on restore; role/title is also the stash's stable identity. */
export function agentOrderKey(agent: { role: string; title: string }): string {
  return `agent:${JSON.stringify([agent.role, agent.title])}`;
}

const byAge = (a: OrderedAgent, b: OrderedAgent) =>
  (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id);

/**
 * Stable order key of every agent. Agents with the same role and title
 * (several "Terminal" shells) are told apart by their rank among those twins
 * (oldest first): the first keeps the plain role/title key, so orders saved
 * before twins were distinguished still apply, the others get `[role, title, n]`.
 * Without the rank all twins shared one key and a drag between them undid itself.
 */
export function agentOrderKeys(agents: readonly OrderedAgent[]): Map<string, string> {
  const groups = new Map<string, OrderedAgent[]>();
  for (const agent of agents) {
    const base = agentOrderKey(agent);
    groups.set(base, [...(groups.get(base) ?? []), agent]);
  }
  const keys = new Map<string, string>();
  for (const [base, twins] of groups) {
    [...twins].sort(byAge).forEach((agent, n) => {
      keys.set(agent.id, n === 0 ? base : `agent:${JSON.stringify([agent.role, agent.title, n])}`);
    });
  }
  return keys;
}

export function orderAgents<T extends OrderedAgent>(agents: readonly T[], order: readonly string[]): T[] {
  const keys = agentOrderKeys(agents);
  const remaining = new Map(agents.map(agent => [agent.id, agent]));
  const result: T[] = [];
  for (const key of order) {
    const agent = remaining.get(key)
      ?? [...remaining.values()].find(item => keys.get(item.id) === key);
    if (!agent) continue;
    result.push(agent);
    remaining.delete(agent.id);
  }
  return [...result, ...[...remaining.values()].sort(byAge)];
}

/** Keep positions for agents still restoring, and append newly opened agents. */
export function rememberAgentOrder<T extends OrderedAgent>(agents: readonly T[], order: readonly string[]): string[] {
  const keys = agentOrderKeys(agents);
  const result = order.map(key => keys.get(key) ?? key);
  for (const agent of orderAgents(agents, order)) {
    const key = keys.get(agent.id)!;
    if (!result.includes(key)) result.push(key);
  }
  return [...new Set(result)];
}
