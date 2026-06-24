import { writable, readonly, get } from 'svelte/store';
import { Wraith, WraithAgent, Chain } from '@wraith-protocol/sdk';
import type { WraithConfig, AgentConfig, AgentInfo, ChatResponse } from '@wraith-protocol/sdk';

export function useWraith(config?: WraithConfig) {
  const _client = writable<Wraith | null>(null);
  const _agent = writable<WraithAgent | null>(null);
  const _agentInfo = writable<AgentInfo | null>(null);
  const _agents = writable<AgentInfo[]>([]);
  const _loading = writable(false);
  const _error = writable<string | null>(null);

  function init(cfg: WraithConfig) {
    _client.set(new Wraith(cfg));
  }

  if (config) {
    init(config);
  }

  function requireClient(): Wraith {
    const c = get(_client);
    if (!c) throw new Error('Wraith client not initialized');
    return c;
  }

  async function createAgent(cfg: AgentConfig): Promise<WraithAgent> {
    _loading.set(true);
    _error.set(null);
    try {
      const a = await requireClient().createAgent(cfg);
      _agent.set(a);
      _agentInfo.set(a.info);
      return a;
    } catch (e) {
      _error.set(e instanceof Error ? e.message : 'Failed to create agent');
      throw e;
    } finally {
      _loading.set(false);
    }
  }

  async function getAgent(agentId: string): Promise<WraithAgent> {
    _loading.set(true);
    _error.set(null);
    try {
      const a = requireClient().agent(agentId);
      _agent.set(a);
      _agentInfo.set(a.info);
      return a;
    } catch (e) {
      _error.set(e instanceof Error ? e.message : 'Failed to get agent');
      throw e;
    } finally {
      _loading.set(false);
    }
  }

  async function getAgentByWallet(wallet: string): Promise<WraithAgent> {
    _loading.set(true);
    _error.set(null);
    try {
      const a = await requireClient().getAgentByWallet(wallet);
      _agent.set(a);
      _agentInfo.set(a.info);
      return a;
    } catch (e) {
      _error.set(e instanceof Error ? e.message : 'Failed to get agent by wallet');
      throw e;
    } finally {
      _loading.set(false);
    }
  }

  async function getAgentByName(name: string): Promise<WraithAgent> {
    _loading.set(true);
    _error.set(null);
    try {
      const a = await requireClient().getAgentByName(name);
      _agent.set(a);
      _agentInfo.set(a.info);
      return a;
    } catch (e) {
      _error.set(e instanceof Error ? e.message : 'Failed to get agent by name');
      throw e;
    } finally {
      _loading.set(false);
    }
  }

  async function listAgents(): Promise<AgentInfo[]> {
    _loading.set(true);
    _error.set(null);
    try {
      const list = await requireClient().listAgents();
      _agents.set(list);
      return list;
    } catch (e) {
      _error.set(e instanceof Error ? e.message : 'Failed to list agents');
      throw e;
    } finally {
      _loading.set(false);
    }
  }

  async function chat(message: string, conversationId?: string): Promise<ChatResponse> {
    _loading.set(true);
    _error.set(null);
    try {
      const a = get(_agent);
      if (!a) throw new Error('No active agent');
      return await a.chat(message, conversationId);
    } catch (e) {
      _error.set(e instanceof Error ? e.message : 'Chat failed');
      throw e;
    } finally {
      _loading.set(false);
    }
  }

  async function getBalance(): Promise<{ native: string; tokens: Record<string, string> }> {
    _loading.set(true);
    _error.set(null);
    try {
      const a = get(_agent);
      if (!a) throw new Error('No active agent');
      return await a.getBalance();
    } catch (e) {
      _error.set(e instanceof Error ? e.message : 'Failed to get balance');
      throw e;
    } finally {
      _loading.set(false);
    }
  }

  return {
    client: readonly(_client),
    agent: readonly(_agent),
    agentInfo: readonly(_agentInfo),
    agents: readonly(_agents),
    loading: readonly(_loading),
    error: readonly(_error),
    init,
    createAgent,
    getAgent,
    getAgentByWallet,
    getAgentByName,
    listAgents,
    chat,
    getBalance,
    Chain,
  };
}
