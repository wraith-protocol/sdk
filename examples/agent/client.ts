/**
 * Use the Wraith managed agent platform.
 *
 * The agent client handles everything — key derivation, stealth payments,
 * AI chat, and chain operations — via the hosted TEE infrastructure.
 * No crypto libraries, no contracts, no RPC calls.
 */
import { Wraith, Chain } from '@wraith-protocol/sdk';

async function main() {
  // 1. Initialize with your API key
  const wraith = new Wraith({
    apiKey: 'wraith_live_abc123...',
  });

  // 2. Create a single-chain agent
  const agent = await wraith.createAgent({
    name: 'alice',
    chain: Chain.Horizen,
    wallet: '0x...',
    signature: '0x...',
  });

  console.log('Agent created:', agent.info);
  // { chains: [Chain.Horizen], addresses: { horizen: "0x..." }, metaAddresses: { horizen: "st:eth:0x..." } }

  // 3. Chat with the agent — it handles stealth payments via natural language
  const response = await agent.chat('send 0.1 ETH to bob.wraith');
  console.log('Agent:', response.response);
  console.log('Tools used:', response.toolCalls);

  // 4. Check balance
  const balance = await agent.getBalance();
  console.log('Balance:', balance);

  // 5. Get notifications
  const { notifications, unreadCount } = await agent.getNotifications();
  console.log(`${unreadCount} unread notifications`);

  // 6. Create a multichain agent
  const multiAgent = await wraith.createAgent({
    name: 'bob',
    chain: [Chain.Horizen, Chain.Stellar],
    wallet: '0x...',
    signature: '0x...',
  });

  // The AI routes to the correct chain automatically
  await multiAgent.chat('send 10 XLM to carol.wraith on stellar');
  await multiAgent.chat("what's my balance on all chains?");

  // 7. Or deploy on every supported chain
  const omniAgent = await wraith.createAgent({
    name: 'carol',
    chain: Chain.All,
    wallet: '0x...',
    signature: '0x...',
  });
}

main().catch(console.error);
