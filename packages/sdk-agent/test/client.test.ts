import { describe, test, expect, expectTypeOf, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import {
  Wraith,
  WraithAgent,
  AgentResponseError,
  RPCRequestError,
  validateAgentStatus,
  validatePayment,
  parseToolCallPayments,
} from '../src/client';
import { Chain } from '../src/types';
import type { AgentInfo, AgentStatus, Payment } from '../src/types';

const TEST_API_KEY = 'wraith_test_key123';
const AGENT_ID = 'agent-001';

const mockAgentInfo: AgentInfo = {
  id: AGENT_ID,
  name: 'alice',
  chains: [Chain.Horizen],
  addresses: { [Chain.Horizen]: '0xabc123' } as Record<Chain, string>,
  metaAddresses: { [Chain.Horizen]: 'st:eth:0xdef456' } as Record<Chain, string>,
};

let server: Server;
let baseUrl: string;
let nextStatusPayload: unknown;
let nextStatusRawBody: string | null = null;
let nextChatPayload: unknown;
let lastRequest: {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: any;
};

function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve(null);
      }
    });
  });
}

beforeEach(() => {
  nextStatusPayload = { balance: '1.5', tokens: { USDC: '100' } };
  nextStatusRawBody = null;
  nextChatPayload = {
    response: 'Hello! How can I help?',
    toolCalls: [],
    conversationId: 'conv-001',
  };
});

beforeAll(async () => {
  server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const body = await parseBody(req);
    lastRequest = {
      method: req.method || '',
      url: req.url || '',
      headers: req.headers as Record<string, string | string[] | undefined>,
      body,
    };

    res.setHeader('Content-Type', 'application/json');

    if (req.url === '/agent/create' && req.method === 'POST') {
      res.end(JSON.stringify(mockAgentInfo));
      return;
    }

    if (req.url === `/agent/${AGENT_ID}/chat` && req.method === 'POST') {
      res.end(JSON.stringify(nextChatPayload));
      return;
    }

    if (req.url === `/agent/${AGENT_ID}/status` && req.method === 'GET') {
      if (nextStatusRawBody !== null) {
        res.end(nextStatusRawBody);
      } else {
        res.end(JSON.stringify(nextStatusPayload));
      }
      return;
    }

    if (req.url === `/agent/${AGENT_ID}/export` && req.method === 'POST') {
      res.end(JSON.stringify({ secret: '0xsecretkey' }));
      return;
    }

    if (req.url === `/agent/${AGENT_ID}/notifications` && req.method === 'GET') {
      res.end(
        JSON.stringify({
          notifications: [
            {
              id: 1,
              type: 'payment',
              title: 'Payment received',
              body: '0.1 ETH',
              read: false,
              createdAt: '2024-01-01',
            },
          ],
          unreadCount: 1,
        }),
      );
      return;
    }

    if (req.url === `/agent/${AGENT_ID}/notifications/read` && req.method === 'POST') {
      res.end(JSON.stringify({}));
      return;
    }

    if (req.url === `/agent/${AGENT_ID}/notifications` && req.method === 'DELETE') {
      res.end(JSON.stringify({}));
      return;
    }

    if (req.url === `/agent/${AGENT_ID}/conversations` && req.method === 'GET') {
      res.end(
        JSON.stringify([
          { id: 'conv-001', title: 'Test', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
        ]),
      );
      return;
    }

    if (req.url === `/agent/wallet/0xwallet` && req.method === 'GET') {
      res.end(JSON.stringify(mockAgentInfo));
      return;
    }

    if (req.url === `/agent/info/alice` && req.method === 'GET') {
      res.end(JSON.stringify(mockAgentInfo));
      return;
    }

    if (req.url === '/agents' && req.method === 'GET') {
      res.end(JSON.stringify([mockAgentInfo]));
      return;
    }

    if (req.url === '/error-test') {
      res.statusCode = 400;
      res.end(JSON.stringify({ message: 'provider response secret' }));
      return;
    }

    if (req.url === '/slow') {
      const timer = setTimeout(() => res.end(JSON.stringify({ ok: true })), 250);
      res.on('close', () => clearTimeout(timer));
      return;
    }

    if (req.url === '/oversized') {
      res.end(' '.repeat(1024 * 1024 + 1));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ message: 'Not found' }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://localhost:${addr.port}`;
      }
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
});

describe('Wraith', () => {
  test('createAgent sends POST to /agent/create', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = await wraith.createAgent({
      name: 'alice',
      chain: Chain.Horizen,
      wallet: '0xwallet',
      signature: '0xsig',
    });

    expect(agent).toBeInstanceOf(WraithAgent);
    expect(agent.info.id).toBe(AGENT_ID);
    expect(agent.info.name).toBe('alice');
    expect(lastRequest.method).toBe('POST');
    expect(lastRequest.url).toBe('/agent/create');
    expect(lastRequest.body.name).toBe('alice');
  });

  test('auth header is present', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    await wraith.listAgents();

    expect(lastRequest.headers['authorization']).toBe(`Bearer ${TEST_API_KEY}`);
  });

  test('AI headers are present when configured', async () => {
    const wraith = new Wraith({
      apiKey: TEST_API_KEY,
      baseUrl,
      ai: { provider: 'openai', apiKey: 'sk-test' },
    });
    await wraith.listAgents();

    expect(lastRequest.headers['x-ai-provider']).toBe('openai');
    expect(lastRequest.headers['x-ai-key']).toBe('sk-test');
  });

  test('AI headers are absent without config', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    await wraith.listAgents();

    expect(lastRequest.headers['x-ai-provider']).toBeUndefined();
    expect(lastRequest.headers['x-ai-key']).toBeUndefined();
  });

  test('listAgents returns array', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agents = await wraith.listAgents();

    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('alice');
  });

  test('getAgentByWallet', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = await wraith.getAgentByWallet('0xwallet');

    expect(agent.info.id).toBe(AGENT_ID);
  });

  test('getAgentByName', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = await wraith.getAgentByName('alice');

    expect(agent.info.id).toBe(AGENT_ID);
  });

  test('HTTP errors do not expose provider response payloads', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });

    await expect(wraith._request('GET', '/error-test')).rejects.toThrow(RPCRequestError);
    await expect(wraith._request('GET', '/error-test')).rejects.not.toThrow(
      'provider response secret',
    );
  });

  test('caller cancellation aborts an in-flight request', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const controller = new AbortController();
    const request = wraith._request('GET', '/slow', undefined, { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('requests time out after the configured duration', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl, timeoutMs: 10 });

    await expect(wraith._request('GET', '/slow')).rejects.toThrow('Request timed out after 10ms');
  });

  test('oversized JSON responses are rejected', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });

    await expect(wraith._request('GET', '/oversized')).rejects.toMatchObject({
      name: 'AgentResponseError',
      field: 'body',
    });
  });
});

describe('WraithAgent', () => {
  test('chat sends message and returns response', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = await wraith.createAgent({
      name: 'alice',
      chain: Chain.Horizen,
      wallet: '0xwallet',
      signature: '0xsig',
    });

    const res = await agent.chat('hello');

    expect(res.response).toBe('Hello! How can I help?');
    expect(res.conversationId).toBe('conv-001');
    expect(lastRequest.method).toBe('POST');
    expect(lastRequest.url).toBe(`/agent/${AGENT_ID}/chat`);
    expect(lastRequest.body.message).toBe('hello');
  });

  test('getStatus returns typed AgentStatus for a valid payload', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = wraith.agent(AGENT_ID);

    const statusPromise = agent.getStatus();
    expectTypeOf(statusPromise).toEqualTypeOf<Promise<AgentStatus>>();

    const status = await statusPromise;
    expect(status).toEqual({ balance: '1.5', tokens: { USDC: '100' } });
  });

  test('getStatus throws AgentResponseError when response body is not valid JSON', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = wraith.agent(AGENT_ID);
    nextStatusRawBody = '<<<not-json>>>';

    await expect(agent.getStatus()).rejects.toMatchObject({
      name: 'AgentResponseError',
      code: 'WRAITH/NETWORK/AGENT_RESPONSE',
      field: 'body',
    });
  });

  test('getStatus throws AgentResponseError when payload is not an object', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = wraith.agent(AGENT_ID);
    nextStatusPayload = ['not', 'an', 'object'];

    await expect(agent.getStatus()).rejects.toMatchObject({
      name: 'AgentResponseError',
      code: 'WRAITH/NETWORK/AGENT_RESPONSE',
      field: 'body',
    });
  });

  test('getStatus throws AgentResponseError when balance is missing or not a non-empty string', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = wraith.agent(AGENT_ID);

    for (const invalidBalance of [undefined, null, 1.5, '', '   ', {}]) {
      nextStatusPayload = { balance: invalidBalance, tokens: { USDC: '100' } };
      await expect(agent.getStatus()).rejects.toMatchObject({
        name: 'AgentResponseError',
        code: 'WRAITH/NETWORK/AGENT_RESPONSE',
        field: 'balance',
      });
    }
  });

  test('getStatus throws AgentResponseError when tokens is missing or malformed', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = wraith.agent(AGENT_ID);

    for (const invalidTokens of [undefined, null, ['USDC'], '100']) {
      nextStatusPayload = { balance: '1.5', tokens: invalidTokens };
      await expect(agent.getStatus()).rejects.toMatchObject({
        name: 'AgentResponseError',
        code: 'WRAITH/NETWORK/AGENT_RESPONSE',
        field: 'tokens',
      });
    }

    nextStatusPayload = { balance: '1.5', tokens: { USDC: 100 } };
    await expect(agent.getStatus()).rejects.toMatchObject({
      name: 'AgentResponseError',
      code: 'WRAITH/NETWORK/AGENT_RESPONSE',
      field: 'tokens.USDC',
    });

    nextStatusPayload = { balance: '1.5', tokens: { USDC: '' } };
    await expect(agent.getStatus()).rejects.toMatchObject({
      name: 'AgentResponseError',
      code: 'WRAITH/NETWORK/AGENT_RESPONSE',
      field: 'tokens.USDC',
    });
  });

  test('getBalance returns formatted balance and propagates status validation errors', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = wraith.agent(AGENT_ID);

    const balance = await agent.getBalance();
    expect(balance.native).toBe('1.5');
    expect(balance.tokens.USDC).toBe('100');

    nextStatusPayload = { balance: 123, tokens: {} };
    await expect(agent.getBalance()).rejects.toThrow(AgentResponseError);
  });

  test('scanPayments parses and validates tool-call payment records', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = wraith.agent(AGENT_ID);

    const validPayments: Payment[] = [
      {
        stealthAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        balance: '10.5',
        ephemeralPubKey: '0x1111111111111111111111111111111111111111111111111111111111111111',
      },
      {
        stealthAddress: '0x1234567890abcdef1234567890abcdef12345678',
        balance: '0.25',
        ephemeralPubKey: '0x02abcdef',
      },
    ];

    nextChatPayload = {
      response: 'Found 2 incoming payments.',
      conversationId: 'conv-scan-1',
      toolCalls: [
        { name: 'resolve_name', status: 'completed', detail: 'non-json-ignored-for-other-tools' },
        {
          name: 'scan_payments',
          status: 'completed',
          detail: JSON.stringify(validPayments),
        },
      ],
    };

    const paymentsPromise = agent.scanPayments();
    expectTypeOf(paymentsPromise).toEqualTypeOf<Promise<Payment[]>>();

    const payments = await paymentsPromise;
    expect(payments).toEqual(validPayments);
  });

  test('scanPayments returns empty array when no scan_payments tool call is present', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = wraith.agent(AGENT_ID);

    nextChatPayload = {
      response: 'No payments found.',
      conversationId: 'conv-scan-empty',
    };
    await expect(agent.scanPayments()).resolves.toEqual([]);
  });

  test('scanPayments throws AgentResponseError when scan_payments detail is missing or invalid JSON', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = wraith.agent(AGENT_ID);

    nextChatPayload = {
      response: 'Scanned',
      conversationId: 'conv-bad-detail',
      toolCalls: [{ name: 'scan_payments', status: 'completed' }],
    };
    await expect(agent.scanPayments()).rejects.toMatchObject({
      name: 'AgentResponseError',
      code: 'WRAITH/NETWORK/AGENT_RESPONSE',
      field: 'toolCalls[0].detail',
    });

    nextChatPayload = {
      response: 'Scanned',
      conversationId: 'conv-bad-json',
      toolCalls: [{ name: 'scan_payments', status: 'completed', detail: '{malformed-json' }],
    };
    await expect(agent.scanPayments()).rejects.toMatchObject({
      name: 'AgentResponseError',
      code: 'WRAITH/NETWORK/AGENT_RESPONSE',
      field: 'toolCalls[0].detail',
    });
  });

  test('scanPayments throws AgentResponseError when parsed detail is not an array', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = wraith.agent(AGENT_ID);

    nextChatPayload = {
      response: 'Scanned',
      conversationId: 'conv-non-array',
      toolCalls: [
        {
          name: 'scan_payments',
          status: 'completed',
          detail: JSON.stringify({
            stealthAddress: 'GAAA',
            balance: '10',
            ephemeralPubKey: '0x11',
          }),
        },
      ],
    };

    await expect(agent.scanPayments()).rejects.toMatchObject({
      name: 'AgentResponseError',
      code: 'WRAITH/NETWORK/AGENT_RESPONSE',
      field: 'toolCalls[0].detail',
    });
  });

  test('scanPayments throws AgentResponseError when any payment record has missing or wrong-type fields', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = wraith.agent(AGENT_ID);

    const invalidCases: Array<{ record: unknown; expectedField: string }> = [
      { record: null, expectedField: 'toolCalls[0].detail[0]' },
      { record: 'not-an-object', expectedField: 'toolCalls[0].detail[0]' },
      {
        record: { balance: '10', ephemeralPubKey: '0x11' },
        expectedField: 'toolCalls[0].detail[0].stealthAddress',
      },
      {
        record: { stealthAddress: 123, balance: '10', ephemeralPubKey: '0x11' },
        expectedField: 'toolCalls[0].detail[0].stealthAddress',
      },
      {
        record: { stealthAddress: '0xabc', balance: 10, ephemeralPubKey: '0x11' },
        expectedField: 'toolCalls[0].detail[0].balance',
      },
      {
        record: { stealthAddress: '0xabc', balance: '10', ephemeralPubKey: '' },
        expectedField: 'toolCalls[0].detail[0].ephemeralPubKey',
      },
    ];

    for (const { record, expectedField } of invalidCases) {
      nextChatPayload = {
        response: 'Scanned',
        conversationId: 'conv-invalid-record',
        toolCalls: [
          {
            name: 'scan_payments',
            status: 'completed',
            detail: JSON.stringify([record]),
          },
        ],
      };

      await expect(agent.scanPayments()).rejects.toMatchObject({
        name: 'AgentResponseError',
        code: 'WRAITH/NETWORK/AGENT_RESPONSE',
        field: expectedField,
      });
    }
  });

  test('chat throws AgentResponseError on malformed ChatResponse envelope or toolCalls', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = wraith.agent(AGENT_ID);

    nextChatPayload = { response: 123, conversationId: 'conv-1' };
    await expect(agent.chat('hi')).rejects.toMatchObject({
      name: 'AgentResponseError',
      field: 'response',
    });

    nextChatPayload = { response: 'ok', conversationId: '' };
    await expect(agent.chat('hi')).rejects.toMatchObject({
      name: 'AgentResponseError',
      field: 'conversationId',
    });

    nextChatPayload = { response: 'ok', conversationId: 'conv-1', toolCalls: 'not-an-array' };
    await expect(agent.chat('hi')).rejects.toMatchObject({
      name: 'AgentResponseError',
      field: 'toolCalls',
    });

    nextChatPayload = {
      response: 'ok',
      conversationId: 'conv-1',
      toolCalls: [{ name: 'scan_payments', status: 200 }],
    };
    await expect(agent.chat('hi')).rejects.toMatchObject({
      name: 'AgentResponseError',
      field: 'toolCalls[0].status',
    });
  });

  test('validation helpers validateAgentStatus, validatePayment, and parseToolCallPayments directly', () => {
    const url = 'https://api.wraith.dev/agent/agent-001/status';
    expect(validateAgentStatus({ balance: '5.0', tokens: { XLM: '10' } }, url)).toEqual({
      balance: '5.0',
      tokens: { XLM: '10' },
    });

    const payment = validatePayment(
      { stealthAddress: 'GABC', balance: '2.5', ephemeralPubKey: '0xdeadbeef' },
      url,
    );
    expect(payment.stealthAddress).toBe('GABC');

    expect(parseToolCallPayments(JSON.stringify([payment]), url)).toEqual([payment]);
  });

  test('exportKey sends signature', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = wraith.agent(AGENT_ID);

    const result = await agent.exportKey('0xsig', 'Export key');

    expect(result.secret).toBe('0xsecretkey');
    expect(lastRequest.url).toBe(`/agent/${AGENT_ID}/export`);
    expect(lastRequest.body.signature).toBe('0xsig');
  });

  test('getNotifications returns notifications', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = wraith.agent(AGENT_ID);

    const result = await agent.getNotifications();

    expect(result.unreadCount).toBe(1);
    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0].title).toBe('Payment received');
  });

  test('markNotificationsRead sends POST', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = wraith.agent(AGENT_ID);

    await agent.markNotificationsRead();

    expect(lastRequest.method).toBe('POST');
    expect(lastRequest.url).toBe(`/agent/${AGENT_ID}/notifications/read`);
  });

  test('getConversations returns list', async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = wraith.agent(AGENT_ID);

    const convos = await agent.getConversations();

    expect(convos).toHaveLength(1);
    expect(convos[0].id).toBe('conv-001');
  });
});
