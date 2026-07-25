<script setup lang="ts">
// Composables are auto-imported by @wraith-protocol/sdk-nuxt — no import needed.

const signatureInput = ref('');

// useStellarStealthKeys is auto-imported from @wraith-protocol/sdk-nuxt
const {
  keys,
  stealthAddress,
  metaAddress,
  loading,
  error,
  deriveKeys,
  generateAddress,
  encodeMetaAddress,
} = useStellarStealthKeys();

const signatureBytes = computed(() => {
  const hex = signatureInput.value.replace(/^0x/i, '');
  if (hex.length < 128) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
});

const canDerive = computed(() => signatureBytes.value !== null && !loading.value);

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function handleDerive() {
  if (!signatureBytes.value) return;
  const k = deriveKeys(signatureBytes.value);
  generateAddress(k.spendingPubKey, k.viewingPubKey);
  encodeMetaAddress(k.spendingPubKey, k.viewingPubKey);
}
</script>

<template>
  <main style="padding: 2rem; font-family: system-ui, sans-serif; max-width: 640px; margin: 0 auto">
    <h1>Wraith SDK — Nuxt Stellar Receive</h1>
    <p>
      Composables are auto-imported by <code>@wraith-protocol/sdk-nuxt</code>. This page works
      server-side rendered and hydrates cleanly on the client.
    </p>

    <section>
      <h2>1. Derive Stealth Keys</h2>
      <p>Paste a 64-byte (128 hex chars) wallet signature:</p>
      <textarea
        v-model="signatureInput"
        rows="3"
        style="width: 100%; font-family: monospace; font-size: 0.85rem"
        placeholder="0xaabbcc..."
        aria-label="Wallet signature hex input"
      />
      <button :disabled="!canDerive" style="margin-top: 0.5rem" @click="handleDerive">
        {{ loading ? 'Deriving…' : 'Derive Keys' }}
      </button>

      <p v-if="error" style="color: red" role="alert">Error: {{ error }}</p>
    </section>

    <section v-if="keys" style="margin-top: 1.5rem">
      <h2>2. Derived Keys</h2>
      <dl>
        <dt>Spending public key</dt>
        <dd style="word-break: break-all; font-family: monospace; font-size: 0.8rem">
          {{ toHex(keys.spendingPubKey) }}
        </dd>
        <dt style="margin-top: 0.5rem">Viewing public key</dt>
        <dd style="word-break: break-all; font-family: monospace; font-size: 0.8rem">
          {{ toHex(keys.viewingPubKey) }}
        </dd>
      </dl>
    </section>

    <section v-if="metaAddress" style="margin-top: 1.5rem">
      <h2>3. Stealth Meta-Address</h2>
      <p>Share this address to receive private payments:</p>
      <code style="word-break: break-all; display: block; background: #f4f4f4; padding: 0.75rem">
        {{ metaAddress }}
      </code>
    </section>

    <section v-if="stealthAddress" style="margin-top: 1.5rem">
      <h2>4. Generated Stealth Address</h2>
      <dl>
        <dt>Stealth address</dt>
        <dd style="word-break: break-all; font-family: monospace; font-size: 0.8rem">
          {{ stealthAddress.stealthAddress }}
        </dd>
      </dl>
    </section>
  </main>
</template>
