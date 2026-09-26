import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useWraith } from '../src/composables/useWraith';

vi.mock('@wraith-protocol/sdk', () => {
  const mockAgent = {
    info: { id: 'agent-1', name: 'test-agent', chains: [], addresses: {}, metaAddresses: {} },
    chat: vi.fn(),
    getBalance: vi.fn(),
  };
  const MockWraith = vi.fn().mockImplementation(() => ({
    createAgent: vi.fn().mockResolvedValue(mockAgent),
    agent: vi.fn().mockReturnValue(mockAgent),
    getAgentByWallet: vi.fn().mockResolvedValue(mockAgent),
    getAgentByName: vi.fn().mockResolvedValue(mockAgent),
    listAgents: vi.fn().mockResolvedValue([mockAgent.info]),
  }));
  return {
    Wraith: MockWraith,
    WraithAgent: vi.fn(),
    Chain: { Stellar: 'stellar', Ethereum: 'ethereum' },
  };
});

describe('useWraith', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with config', () => {
    const composable = useWraith({ apiKey: 'test-key' });
    expect(composable.client.value).toBeTruthy();
  });

  it('initializes lazily via init()', () => {
    const composable = useWraith();
    expect(composable.client.value).toBeNull();
    composable.init({ apiKey: 'test-key' });
    expect(composable.client.value).toBeTruthy();
  });

  it('createAgent sets agent and agentInfo', async () => {
    const composable = useWraith({ apiKey: 'test-key' });
    await composable.createAgent({
      name: 'test',
      chain: 'stellar' as any,
      wallet: 'GABC',
      signature: 'sig',
    });
    expect(composable.agent.value).toBeTruthy();
    expect(composable.agentInfo.value).toBeTruthy();
    expect(composable.agentInfo.value!.id).toBe('agent-1');
  });

  it('throws if client not initialized', async () => {
    const composable = useWraith();
    await expect(composable.createAgent({} as any)).rejects.toThrow(
      'Wraith client not initialized',
    );
  });

  it('sets loading state during async operations', async () => {
    const composable = useWraith({ apiKey: 'test-key' });
    const promise = composable.createAgent({
      name: 'test',
      chain: 'stellar' as any,
      wallet: 'GABC',
      signature: 'sig',
    });
    expect(composable.loading.value).toBe(true);
    await promise;
    expect(composable.loading.value).toBe(false);
  });
});
