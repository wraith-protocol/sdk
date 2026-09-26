import { createSignal } from 'solid-js';
import { Wraith, WraithAgent, Chain } from '@wraith-protocol/sdk';
import type { WraithConfig, AgentConfig, AgentInfo, ChatResponse } from '@wraith-protocol/sdk';

/**
 * Solid primitive for managing Wraith agent activity (chat, balance, agent lifecycle).
 *
 * Mirrors sdk-react's hook contract using Solid's fine-grained signals.
 * All reactive values are returned as getter functions following Solid conventions.
 */
export function createActivity(config?: WraithConfig) {
  const [client, setClient] = createSignal<Wraith | null>(null);
  const [agent, setAgent] = createSignal<WraithAgent | null>(null);
  const [agentInfo, setAgentInfo] = createSignal<AgentInfo | null>(null);
  const [agents, setAgents] = createSignal<AgentInfo[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  function init(cfg: WraithConfig): void {
    setClient(() => new Wraith(cfg));
  }

  if (config) {
    init(config);
  }

  function requireClient(): Wraith {
    const c = client();
    if (!c) throw new Error('Wraith client not initialized');
    return c;
  }

  function requireAgent(): WraithAgent {
    const a = agent();
    if (!a) throw new Error('No active agent');
    return a;
  }

  async function createAgent(cfg: AgentConfig): Promise<WraithAgent> {
    setLoading(true);
    setError(null);
    try {
      const a = await requireClient().createAgent(cfg);
      setAgent(() => a);
      setAgentInfo(() => a.info);
      return a;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create agent');
      throw e;
    } finally {
      setLoading(false);
    }
  }

  async function getAgent(agentId: string): Promise<WraithAgent> {
    setLoading(true);
    setError(null);
    try {
      const a = requireClient().agent(agentId);
      setAgent(() => a);
      setAgentInfo(() => a.info);
      return a;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to get agent');
      throw e;
    } finally {
      setLoading(false);
    }
  }

  async function getAgentByWallet(wallet: string): Promise<WraithAgent> {
    setLoading(true);
    setError(null);
    try {
      const a = await requireClient().getAgentByWallet(wallet);
      setAgent(() => a);
      setAgentInfo(() => a.info);
      return a;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to get agent by wallet');
      throw e;
    } finally {
      setLoading(false);
    }
  }

  async function getAgentByName(name: string): Promise<WraithAgent> {
    setLoading(true);
    setError(null);
    try {
      const a = await requireClient().getAgentByName(name);
      setAgent(() => a);
      setAgentInfo(() => a.info);
      return a;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to get agent by name');
      throw e;
    } finally {
      setLoading(false);
    }
  }

  async function listAgents(): Promise<AgentInfo[]> {
    setLoading(true);
    setError(null);
    try {
      const list = await requireClient().listAgents();
      setAgents(list);
      return list;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to list agents');
      throw e;
    } finally {
      setLoading(false);
    }
  }

  async function chat(message: string, conversationId?: string): Promise<ChatResponse> {
    setLoading(true);
    setError(null);
    try {
      return await requireAgent().chat(message, conversationId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chat failed');
      throw e;
    } finally {
      setLoading(false);
    }
  }

  async function getBalance(): Promise<{ native: string; tokens: Record<string, string> }> {
    setLoading(true);
    setError(null);
    try {
      return await requireAgent().getBalance();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to get balance');
      throw e;
    } finally {
      setLoading(false);
    }
  }

  return {
    // Reactive getters (Solid signal accessors)
    client,
    agent,
    agentInfo,
    agents,
    loading,
    error,
    // Actions
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
