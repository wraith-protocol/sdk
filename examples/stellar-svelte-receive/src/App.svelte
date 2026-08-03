<script lang="ts">
  import {
    useStellarAnnouncementScan,
    useStellarStealthKeys,
  } from '@wraith-protocol/sdk-svelte';

  const {
    keys,
    metaAddress,
    error: keyError,
    generate,
    encodeMetaAddress,
  } = useStellarStealthKeys();
  const { announcements, scanning, error: scanError, scan } = useStellarAnnouncementScan();

  let secret = $state(import.meta.env.VITE_STELLAR_SECRET_KEY ?? '');
  let validationError = $state<string | null>(null);

  function parseSecret(value: string): Uint8Array | null {
    const hex = value.trim().replace(/^0x/i, '');
    if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null;
    return new Uint8Array(hex.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));
  }

  function derive() {
    validationError = null;
    const signature = parseSecret(secret);
    if (!signature) {
      validationError = 'Enter an even-length hexadecimal secret.';
      return;
    }
    if (signature.length !== 64) {
      validationError = `Expected 64 bytes, received ${signature.length}.`;
      return;
    }

    const derived = generate(signature);
    encodeMetaAddress(derived.spendingPubKey, derived.viewingPubKey);
  }

  async function scanPayments() {
    try {
      await scan({});
    } catch {
      // The error store renders the actionable network or RPC message.
    }
  }

  function hex(bytes: Uint8Array): string {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
</script>

<svelte:head>
  <title>Wraith Stellar Receive</title>
</svelte:head>

<main>
  <p class="eyebrow">Wraith Protocol · Svelte</p>
  <h1>Receive Stellar stealth payments</h1>
  <p class="intro">
    Derive a shareable stealth meta-address, then scan Stellar for payments announced to it.
  </p>

  <section>
    <h2>1. Derive your receive address</h2>
    <label for="secret">64-byte secret (hex)</label>
    <textarea
      id="secret"
      bind:value={secret}
      rows="4"
      spellcheck="false"
      placeholder="128 hexadecimal characters"
    ></textarea>
    <button type="button" onclick={derive}>Derive stealth keys</button>

    {#if validationError || $keyError}
      <p class="error" role="alert">{validationError ?? $keyError}</p>
    {/if}

    {#if $keys && $metaAddress}
      <div class="result">
        <span>Stealth meta-address</span>
        <code>{$metaAddress}</code>
        <details>
          <summary>View public keys</summary>
          <dl>
            <dt>Spending</dt>
            <dd>{hex($keys.spendingPubKey)}</dd>
            <dt>Viewing</dt>
            <dd>{hex($keys.viewingPubKey)}</dd>
          </dl>
        </details>
      </div>
    {/if}
  </section>

  <section>
    <div class="section-heading">
      <div>
        <h2>2. Scan announcements</h2>
        <p>Read recent announcements from the configured Stellar deployment.</p>
      </div>
      <button type="button" onclick={scanPayments} disabled={$scanning}>
        {$scanning ? 'Scanning…' : 'Scan now'}
      </button>
    </div>

    {#if $scanError}
      <p class="error" role="alert">{$scanError.message}</p>
    {:else if $announcements.length}
      <ul>
        {#each $announcements as announcement}
          <li>
            <code>{announcement.stealthAddress}</code>
            <span>scheme {announcement.schemeId} · ledger {announcement.ledger ?? 'pending'}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="empty">No announcements loaded yet.</p>
    {/if}
  </section>
</main>

<style>
  :global(*) {
    box-sizing: border-box;
  }
  :global(body) {
    margin: 0;
    min-width: 320px;
    min-height: 100vh;
    color: #e8ecf3;
    background:
      radial-gradient(circle at 15% 10%, rgba(84, 95, 255, 0.2), transparent 28rem),
      #090b11;
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  }
  main {
    width: min(760px, calc(100% - 32px));
    margin: 0 auto;
    padding: 72px 0;
  }
  .eyebrow {
    margin: 0 0 12px;
    color: #9ba7ff;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  h1 {
    max-width: 650px;
    margin: 0;
    font-size: clamp(2.4rem, 7vw, 4.8rem);
    line-height: 0.98;
    letter-spacing: -0.055em;
  }
  .intro {
    max-width: 590px;
    margin: 24px 0 42px;
    color: #aeb6c7;
    font-size: 1.08rem;
    line-height: 1.65;
  }
  section {
    margin-top: 18px;
    padding: 26px;
    border: 1px solid #242a39;
    border-radius: 18px;
    background: rgba(17, 20, 29, 0.88);
  }
  h2 {
    margin: 0 0 18px;
    font-size: 1.15rem;
  }
  label,
  .result span {
    display: block;
    margin-bottom: 8px;
    color: #aeb6c7;
    font-size: 0.82rem;
    font-weight: 650;
  }
  textarea {
    width: 100%;
    resize: vertical;
    padding: 14px;
    border: 1px solid #30384b;
    border-radius: 10px;
    outline: none;
    color: #eff2fa;
    background: #0c0f16;
    font: 0.85rem/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
  }
  textarea:focus {
    border-color: #737fff;
    box-shadow: 0 0 0 3px rgba(115, 127, 255, 0.12);
  }
  button {
    margin-top: 14px;
    padding: 10px 16px;
    border: 0;
    border-radius: 9px;
    color: white;
    background: #5966e9;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  button:disabled {
    cursor: wait;
    opacity: 0.65;
  }
  .result {
    margin-top: 22px;
    padding: 16px;
    border-radius: 12px;
    background: #0c0f16;
  }
  code,
  dd {
    overflow-wrap: anywhere;
    color: #bec5ff;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  }
  details {
    margin-top: 16px;
    color: #aeb6c7;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px 14px;
    font-size: 0.78rem;
  }
  dd {
    margin: 0;
  }
  .section-heading {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 24px;
  }
  .section-heading h2 {
    margin-bottom: 5px;
  }
  .section-heading p,
  .empty {
    margin: 0;
    color: #858fa3;
  }
  .section-heading button {
    flex: 0 0 auto;
    margin-top: 0;
  }
  .error {
    color: #ff9b9b;
  }
  ul {
    display: grid;
    gap: 8px;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    padding: 12px;
    border-radius: 9px;
    background: #0c0f16;
  }
  li span {
    flex: 0 0 auto;
    color: #858fa3;
    font-size: 0.8rem;
  }
  @media (max-width: 560px) {
    main {
      padding: 42px 0;
    }
    section {
      padding: 20px;
    }
    .section-heading,
    li {
      flex-direction: column;
    }
  }
</style>
