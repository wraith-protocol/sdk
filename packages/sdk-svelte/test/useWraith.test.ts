import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@wraith-protocol/sdk', () => {
  const mockAgent = {
    info: {
      id: 'agent-1',
      name: 'test-agent',
      chains: [],
      addresses: {},
      metaAddresses: {},
    },
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

  it('exports the function', async () => {
    const mod = await import('../src/primitives/useWraith.js');
    expect(typeof mod.useWraith).toBe('function');
  });
});
