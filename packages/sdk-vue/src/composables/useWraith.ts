import { ref, readonly, type Ref } from 'vue';
import {
  Wraith,
  WraithAgent,
  Chain,
  type WraithConfig,
  type AgentConfig,
  type AgentInfo,
  type ChatResponse,
} from '@wraith-protocol/sdk';

export function useWraith(config?: WraithConfig) {
  const client: Ref<Wraith | null> = ref(null);
  const agent: Ref<WraithAgent | null> = ref(null);
  const agentInfo: Ref<AgentInfo | null> = ref(null);
  const agents: Ref<AgentInfo[]> = ref([]);
  const loading = ref(false);
  const error: Ref<string | null> = ref(null);

  function init(cfg: WraithConfig) {
    client.value = new Wraith(cfg);
  }

  if (config) {
    init(config);
  }

  async function createAgent(cfg: AgentConfig): Promise<WraithAgent> {
    if (!client.value) throw new Error('Wraith client not initialized');
    loading.value = true;
    error.value = null;
    try {
      const a = await client.value.createAgent(cfg);
      agent.value = a;
      agentInfo.value = a.info;
      return a;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create agent';
      error.value = msg;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function getAgent(agentId: string): Promise<WraithAgent> {
    if (!client.value) throw new Error('Wraith client not initialized');
    loading.value = true;
    error.value = null;
    try {
      const a = client.value.agent(agentId);
      agent.value = a;
      agentInfo.value = a.info;
      return a;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to get agent';
      error.value = msg;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function getAgentByWallet(wallet: string): Promise<WraithAgent> {
    if (!client.value) throw new Error('Wraith client not initialized');
    loading.value = true;
    error.value = null;
    try {
      const a = await client.value.getAgentByWallet(wallet);
      agent.value = a;
      agentInfo.value = a.info;
      return a;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to get agent by wallet';
      error.value = msg;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function getAgentByName(name: string): Promise<WraithAgent> {
    if (!client.value) throw new Error('Wraith client not initialized');
    loading.value = true;
    error.value = null;
    try {
      const a = await client.value.getAgentByName(name);
      agent.value = a;
      agentInfo.value = a.info;
      return a;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to get agent by name';
      error.value = msg;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function listAgents(): Promise<AgentInfo[]> {
    if (!client.value) throw new Error('Wraith client not initialized');
    loading.value = true;
    error.value = null;
    try {
      const list = await client.value.listAgents();
      agents.value = list;
      return list;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to list agents';
      error.value = msg;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function chat(message: string, conversationId?: string): Promise<ChatResponse> {
    if (!agent.value) throw new Error('No active agent');
    loading.value = true;
    error.value = null;
    try {
      return await agent.value.chat(message, conversationId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Chat failed';
      error.value = msg;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function getBalance(): Promise<{ native: string; tokens: Record<string, string> }> {
    if (!agent.value) throw new Error('No active agent');
    loading.value = true;
    error.value = null;
    try {
      return await agent.value.getBalance();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to get balance';
      error.value = msg;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  return {
    client: readonly(client),
    agent: readonly(agent),
    agentInfo: readonly(agentInfo),
    agents: readonly(agents),
    loading: readonly(loading),
    error: readonly(error),
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
