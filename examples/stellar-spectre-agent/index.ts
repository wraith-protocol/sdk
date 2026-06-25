#!/usr/bin/env node
import { Wraith, Chain } from '@wraith-protocol/sdk';

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`ERROR: Missing environment variable ${name}`);
    console.error('Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }
  return value;
}

async function main() {
  console.log('=== Wraith Stellar — Spectre Agent Demo ===\n');

  // 1. Initialize the Wraith client
  const apiKey = getEnv('AGENT_API_KEY');
  const baseUrl = process.env.AGENT_BASE_URL;
  const wraith = new Wraith({ apiKey, ...(baseUrl ? { baseUrl } : {}) });
  console.log('Connected to Wraith API');
  console.log('');

  // 2. Create or retrieve the agent
  const name = getEnv('AGENT_NAME');
  const wallet = getEnv('STELLAR_WALLET');
  const signature = getEnv('STELLAR_SIGNATURE');

  let agent;
  try {
    agent = await wraith.getAgentByName(`${name}.wraith`);
    console.log(`Found existing agent "${name}"`);
  } catch {
    agent = await wraith.createAgent({
      name,
      chain: Chain.Stellar,
      wallet,
      signature,
    });
    console.log(`Created new agent "${name}" on Stellar`);
  }
  console.log('Agent ID:', agent.info.id);
  console.log(
    'Chains:',
    agent.info.chains.map((c) => c),
  );
  console.log('Address:', agent.info.addresses[Chain.Stellar]);
  console.log('Meta-address:', agent.info.metaAddresses[Chain.Stellar]);
  console.log('');

  // 3. Chat with the agent
  console.log('--- Chat with Agent ---');
  const chatResponse = await agent.chat("What's my balance?");
  console.log('Agent:', chatResponse.response);
  if (chatResponse.toolCalls?.length) {
    console.log('Tools used:');
    for (const tc of chatResponse.toolCalls) {
      console.log(`  - ${tc.name}: ${tc.status}`);
    }
  }
  console.log('');

  // 4. Check balance programmatically
  console.log('--- Balance ---');
  const balance = await agent.getBalance();
  console.log('Native balance:', balance.native);
  if (Object.keys(balance.tokens).length) {
    console.log('Tokens:', balance.tokens);
  }
  console.log('');

  // 5. Scan for stealth payments
  console.log('--- Scanning for Payments ---');
  const payments = await agent.scanPayments();
  if (payments.length === 0) {
    console.log('No stealth payments found.');
  } else {
    for (const p of payments) {
      console.log('Stealth address:', p.stealthAddress);
      console.log('Balance:', p.balance);
      console.log('Ephemeral pub key:', p.ephemeralPubKey);
      console.log('');
    }
  }

  // 6. Check notifications
  console.log('--- Notifications ---');
  const { notifications, unreadCount } = await agent.getNotifications();
  console.log(`${unreadCount} unread notification(s)`);
  for (const n of notifications.slice(0, 5)) {
    console.log(`  [${n.type}] ${n.title}: ${n.body}`);
  }
  console.log('');

  // 7. Send a stealth payment via natural language
  console.log('--- Send Stealth Payment ---');
  const sendResponse = await agent.chat('send 1 XLM to alice.wraith');
  console.log('Agent:', sendResponse.response);
  if (sendResponse.toolCalls?.length) {
    for (const tc of sendResponse.toolCalls) {
      console.log(`  - ${tc.name}: ${tc.status}${tc.detail ? ` (${tc.detail})` : ''}`);
    }
  }
  console.log('');

  console.log('=== Demo Complete ===');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
