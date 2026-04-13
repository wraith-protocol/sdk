import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "http";
import { Wraith, WraithAgent } from "../../src/agent/client";
import { Chain } from "../../src/agent/types";
import type { AgentInfo } from "../../src/agent/types";

const TEST_API_KEY = "wraith_test_key123";
const AGENT_ID = "agent-001";

const mockAgentInfo: AgentInfo = {
  id: AGENT_ID,
  name: "alice",
  chains: [Chain.Horizen],
  addresses: { [Chain.Horizen]: "0xabc123" } as Record<Chain, string>,
  metaAddresses: { [Chain.Horizen]: "st:eth:0xdef456" } as Record<Chain, string>,
};

let server: Server;
let baseUrl: string;
let lastRequest: {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: any;
};

function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk: Buffer) => { data += chunk.toString(); });
    req.on("end", () => {
      try { resolve(JSON.parse(data)); } catch { resolve(null); }
    });
  });
}

beforeAll(async () => {
  server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const body = await parseBody(req);
    lastRequest = {
      method: req.method || "",
      url: req.url || "",
      headers: req.headers as Record<string, string | string[] | undefined>,
      body,
    };

    res.setHeader("Content-Type", "application/json");

    if (req.url === "/agent/create" && req.method === "POST") {
      res.end(JSON.stringify(mockAgentInfo));
      return;
    }

    if (req.url === `/agent/${AGENT_ID}/chat` && req.method === "POST") {
      res.end(JSON.stringify({
        response: "Hello! How can I help?",
        toolCalls: [],
        conversationId: "conv-001",
      }));
      return;
    }

    if (req.url === `/agent/${AGENT_ID}/status` && req.method === "GET") {
      res.end(JSON.stringify({ balance: "1.5", tokens: { USDC: "100" } }));
      return;
    }

    if (req.url === `/agent/${AGENT_ID}/export` && req.method === "POST") {
      res.end(JSON.stringify({ secret: "0xsecretkey" }));
      return;
    }

    if (req.url === `/agent/${AGENT_ID}/notifications` && req.method === "GET") {
      res.end(JSON.stringify({
        notifications: [{ id: 1, type: "payment", title: "Payment received", body: "0.1 ETH", read: false, createdAt: "2024-01-01" }],
        unreadCount: 1,
      }));
      return;
    }

    if (req.url === `/agent/${AGENT_ID}/notifications/read` && req.method === "POST") {
      res.end(JSON.stringify({}));
      return;
    }

    if (req.url === `/agent/${AGENT_ID}/notifications` && req.method === "DELETE") {
      res.end(JSON.stringify({}));
      return;
    }

    if (req.url === `/agent/${AGENT_ID}/conversations` && req.method === "GET") {
      res.end(JSON.stringify([{ id: "conv-001", title: "Test", createdAt: "2024-01-01", updatedAt: "2024-01-01" }]));
      return;
    }

    if (req.url === `/agent/wallet/0xwallet` && req.method === "GET") {
      res.end(JSON.stringify(mockAgentInfo));
      return;
    }

    if (req.url === `/agent/info/alice` && req.method === "GET") {
      res.end(JSON.stringify(mockAgentInfo));
      return;
    }

    if (req.url === "/agents" && req.method === "GET") {
      res.end(JSON.stringify([mockAgentInfo]));
      return;
    }

    if (req.url === "/error-test") {
      res.statusCode = 400;
      res.end(JSON.stringify({ message: "Bad request" }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ message: "Not found" }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        baseUrl = `http://localhost:${addr.port}`;
      }
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
});

describe("Wraith", () => {
  test("createAgent sends POST to /agent/create", async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = await wraith.createAgent({
      name: "alice",
      chain: Chain.Horizen,
      wallet: "0xwallet",
      signature: "0xsig",
    });

    expect(agent).toBeInstanceOf(WraithAgent);
    expect(agent.info.id).toBe(AGENT_ID);
    expect(agent.info.name).toBe("alice");
    expect(lastRequest.method).toBe("POST");
    expect(lastRequest.url).toBe("/agent/create");
    expect(lastRequest.body.name).toBe("alice");
  });

  test("auth header is present", async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    await wraith.listAgents();

    expect(lastRequest.headers["authorization"]).toBe(`Bearer ${TEST_API_KEY}`);
  });

  test("AI headers are present when configured", async () => {
    const wraith = new Wraith({
      apiKey: TEST_API_KEY,
      baseUrl,
      ai: { provider: "openai", apiKey: "sk-test" },
    });
    await wraith.listAgents();

    expect(lastRequest.headers["x-ai-provider"]).toBe("openai");
    expect(lastRequest.headers["x-ai-key"]).toBe("sk-test");
  });

  test("AI headers are absent without config", async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    await wraith.listAgents();

    expect(lastRequest.headers["x-ai-provider"]).toBeUndefined();
    expect(lastRequest.headers["x-ai-key"]).toBeUndefined();
  });

  test("listAgents returns array", async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agents = await wraith.listAgents();

    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("alice");
  });

  test("getAgentByWallet", async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = await wraith.getAgentByWallet("0xwallet");

    expect(agent.info.id).toBe(AGENT_ID);
  });

  test("getAgentByName", async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = await wraith.getAgentByName("alice");

    expect(agent.info.id).toBe(AGENT_ID);
  });

  test("HTTP error throws with server message", async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });

    await expect(
      wraith._request("GET", "/error-test")
    ).rejects.toThrow("Bad request");
  });
});

describe("WraithAgent", () => {
  test("chat sends message and returns response", async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = await wraith.createAgent({
      name: "alice",
      chain: Chain.Horizen,
      wallet: "0xwallet",
      signature: "0xsig",
    });

    const res = await agent.chat("hello");

    expect(res.response).toBe("Hello! How can I help?");
    expect(res.conversationId).toBe("conv-001");
    expect(lastRequest.method).toBe("POST");
    expect(lastRequest.url).toBe(`/agent/${AGENT_ID}/chat`);
    expect(lastRequest.body.message).toBe("hello");
  });

  test("getBalance returns formatted balance", async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = wraith.agent(AGENT_ID);

    const balance = await agent.getBalance();

    expect(balance.native).toBe("1.5");
    expect(balance.tokens.USDC).toBe("100");
  });

  test("exportKey sends signature", async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = wraith.agent(AGENT_ID);

    const result = await agent.exportKey("0xsig", "Export key");

    expect(result.secret).toBe("0xsecretkey");
    expect(lastRequest.url).toBe(`/agent/${AGENT_ID}/export`);
    expect(lastRequest.body.signature).toBe("0xsig");
  });

  test("getNotifications returns notifications", async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = wraith.agent(AGENT_ID);

    const result = await agent.getNotifications();

    expect(result.unreadCount).toBe(1);
    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0].title).toBe("Payment received");
  });

  test("markNotificationsRead sends POST", async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = wraith.agent(AGENT_ID);

    await agent.markNotificationsRead();

    expect(lastRequest.method).toBe("POST");
    expect(lastRequest.url).toBe(`/agent/${AGENT_ID}/notifications/read`);
  });

  test("getConversations returns list", async () => {
    const wraith = new Wraith({ apiKey: TEST_API_KEY, baseUrl });
    const agent = wraith.agent(AGENT_ID);

    const convos = await agent.getConversations();

    expect(convos).toHaveLength(1);
    expect(convos[0].id).toBe("conv-001");
  });
});
