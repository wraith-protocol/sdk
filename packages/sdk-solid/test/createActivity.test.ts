import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createActivity } from '../src/primitives/createActivity';

const mockAgentInfo = vi.hoisted(() => ({
  id: 'agent-1',
  name: 'test-agent',
  chains: ['stellar'],
  addresses: { stellar: 'G...' },
  wallet: '0x...',
}));

const mockAgent = vi.hoisted(() => ({
  info: mockAgentInfo,
  chat: vi.fn().mockResolvedValue({ response: 'hello' }),
  getBalance: vi.fn().mockResolvedValue({ native: '10.5', tokens: {} }),
}));

const mockClient = vi.hoisted(() => ({
  createAgent: vi.fn().mockResolvedValue(mockAgent),
  agent: vi.fn().mockReturnValue(mockAgent),
  getAgentByWallet: vi.fn().mockResolvedValue(mockAgent),
  getAgentByName: vi.fn().mockResolvedValue(mockAgent),
  listAgents: vi.fn().mockResolvedValue([mockAgentInfo]),
}));

vi.mock('@wraith-protocol/sdk', () => ({
  Wraith: vi.fn().mockImplementation(() => mockClient),
  WraithAgent: vi.fn(),
  Chain: {
    Stellar: 'stellar',
    Ethereum: 'ethereum',
    All: 'all',
  },
}));

// Grab mocked references once (safe because vi.mock hoists before imports)
import { Wraith as MockWraith } from '@wraith-protocol/sdk';

describe('createActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports the function', () => {
    expect(typeof createActivity).toBe('function');
  });

  it('initialises with null reactive state', () => {
    const primitive = createActivity();
    expect(primitive.client()).toBeNull();
    expect(primitive.agent()).toBeNull();
    expect(primitive.agentInfo()).toBeNull();
    expect(primitive.agents()).toEqual([]);
    expect(primitive.loading()).toBe(false);
    expect(primitive.error()).toBeNull();
  });

  it('init creates the Wraith client', () => {
    const primitive = createActivity();
    primitive.init({ apiKey: 'test-key' });

    expect(vi.mocked(MockWraith)).toHaveBeenCalledWith({ apiKey: 'test-key' });
    expect(primitive.client()).not.toBeNull();
  });

  it('auto-inits when config is provided', () => {
    createActivity({ apiKey: 'auto-key' });
    expect(vi.mocked(MockWraith)).toHaveBeenCalledWith({ apiKey: 'auto-key' });
  });

  it('createAgent updates agent and agentInfo signals', async () => {
    const primitive = createActivity();
    primitive.init({ apiKey: 'test-key' });

    const result = await primitive.createAgent({
      name: 'test',
      chain: 'stellar' as any,
      wallet: '0x...',
      signature: '0x...',
    });

    expect(result).toBe(mockAgent);
    expect(primitive.agent()).toBe(mockAgent);
    expect(primitive.agentInfo()).toEqual(mockAgentInfo);
    expect(primitive.loading()).toBe(false);
  });

  it('getAgent updates agent and agentInfo signals', async () => {
    const primitive = createActivity();
    primitive.init({ apiKey: 'test-key' });

    await primitive.getAgent('agent-1');
    expect(primitive.agent()).toBe(mockAgent);
    expect(primitive.agentInfo()).toEqual(mockAgentInfo);
  });

  it('listAgents updates agents signal', async () => {
    const primitive = createActivity();
    primitive.init({ apiKey: 'test-key' });

    const result = await primitive.listAgents();
    expect(result).toEqual([mockAgentInfo]);
    expect(primitive.agents()).toEqual([mockAgentInfo]);
  });

  it('chat returns response', async () => {
    const primitive = createActivity();
    primitive.init({ apiKey: 'test-key' });
    await primitive.createAgent({
      name: 'test',
      chain: 'stellar' as any,
      wallet: '0x...',
      signature: '0x...',
    });

    const result = await primitive.chat('hello');
    expect(result).toEqual({ response: 'hello' });
  });

  it('getBalance returns balance', async () => {
    const primitive = createActivity();
    primitive.init({ apiKey: 'test-key' });
    await primitive.createAgent({
      name: 'test',
      chain: 'stellar' as any,
      wallet: '0x...',
      signature: '0x...',
    });

    const result = await primitive.getBalance();
    expect(result).toEqual({ native: '10.5', tokens: {} });
  });

  it('throws when client is not initialised', async () => {
    const primitive = createActivity();
    await expect(
      primitive.createAgent({
        name: 'x',
        chain: 'stellar' as any,
        wallet: '0x...',
        signature: '0x...',
      }),
    ).rejects.toThrow('Wraith client not initialized');
  });

  it('throws when no active agent for chat', async () => {
    const primitive = createActivity();
    primitive.init({ apiKey: 'test-key' });
    await expect(primitive.chat('hello')).rejects.toThrow('No active agent');
  });

  it('sets error signal and loading false on failure', async () => {
    mockClient.createAgent.mockRejectedValueOnce(new Error('create failed'));

    const primitive = createActivity();
    primitive.init({ apiKey: 'test-key' });

    await expect(
      primitive.createAgent({
        name: 'x',
        chain: 'stellar' as any,
        wallet: '0x...',
        signature: '0x...',
      }),
    ).rejects.toThrow();
    expect(primitive.error()).toBe('create failed');
    expect(primitive.loading()).toBe(false);
  });

  it('exposes Chain enum', () => {
    const primitive = createActivity();
    expect(primitive.Chain.Stellar).toBe('stellar');
  });
});
