<script lang="ts">
  import { useStellarStealthKeys, useStealthMetaAddress } from '@wraith-protocol/sdk-svelte';

  const stellar = useStellarStealthKeys();
  const meta = useStealthMetaAddress();

  let signatureInput = $state('');

  function handleDerive() {
    const hex = signatureInput.replace(/^0x/i, '');
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    if (bytes.length < 32) return;

    const k = stellar.deriveKeys(bytes);
    console.log('Derived keys:', k);
    const addr = stellar.generateAddress(k.spendingPubKey, k.viewingPubKey);
    console.log('Stealth address:', addr);
    stellar.encodeMetaAddress(k.spendingPubKey, k.viewingPubKey);
  }

  function handleDecode() {
    if ($stellar.metaAddress) {
      meta.decode($stellar.metaAddress);
    }
  }
</script>

<div class="container">
  <h1>Wraith SDK &mdash; Svelte 5 Example</h1>

  <section>
    <h2>Stellar Stealth Keys</h2>
    <label>
      Signature (hex):
      <input bind:value={signatureInput} placeholder="e.g. deadbeef..." />
    </label>
    <button onclick={handleDerive}>
      Derive Keys & Generate Address
    </button>

    {#if $stellar.error}
      <p class="error">{$stellar.error}</p>
    {/if}

    {#if $stellar.keys}
      <div>
        <h3>Keys</h3>
        <pre>{JSON.stringify($stellar.keys, (_, v) => (v instanceof Uint8Array ? Array.from(v) : v), 2)}</pre>
      </div>
    {/if}

    {#if $stellar.stealthAddress}
      <div>
        <h3>Stealth Address</h3>
        <pre>{JSON.stringify($stellar.stealthAddress, (_, v) => (v instanceof Uint8Array ? Array.from(v) : v), 2)}</pre>
      </div>
    {/if}

    {#if $stellar.metaAddress}
      <div>
        <h3>Meta Address</h3>
        <code>{$stellar.metaAddress}</code>
        <button onclick={handleDecode}>Decode</button>
      </div>
    {/if}

    {#if $meta.decoded}
      <div>
        <h3>Decoded Meta Address</h3>
        <pre>{JSON.stringify($meta.decoded, (_, v) => (v instanceof Uint8Array ? Array.from(v) : v), 2)}</pre>
      </div>
    {/if}
  </section>
</div>

<style>
  .container {
    padding: 2rem;
    font-family: system-ui, sans-serif;
  }
  input {
    width: 100%;
  }
  .error {
    color: red;
  }
  button {
    margin-top: 0.5rem;
  }
</style>
