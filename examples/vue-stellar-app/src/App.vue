<script setup lang="ts">
import { useStellarStealthKeys, useStealthMetaAddress } from '@wraith-protocol/sdk-vue';
import { ref, computed } from 'vue';

const signatureInput = ref('');
const {
  keys,
  stealthAddress,
  deriveKeys,
  generateAddress,
  metaAddress,
  encodeMetaAddress,
  error,
  loading,
} = useStellarStealthKeys();

const { encode, decode, decoded, detectChain } = useStealthMetaAddress();

const signatureBytes = computed(() => {
  const hex = signatureInput.value.replace(/^0x/i, '');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
});

function handleDerive() {
  if (signatureInput.value.length < 64) return;
  const k = deriveKeys(signatureBytes.value);
  console.log('Derived keys:', k);
  const addr = generateAddress(k.spendingPubKey, k.viewingPubKey);
  console.log('Stealth address:', addr);
  encodeMetaAddress(k.spendingPubKey, k.viewingPubKey);
}

function handleDecode() {
  if (!metaAddress.value) return;
  decode(metaAddress.value);
  detectChain(metaAddress.value);
}
</script>

<template>
  <div style="padding: 2rem; font-family: system-ui, sans-serif">
    <h1>Wraith SDK &mdash; Vue 3 Example</h1>

    <section>
      <h2>Stellar Stealth Keys</h2>
      <label>
        Signature (hex):
        <input v-model="signatureInput" placeholder="e.g. deadbeef..." style="width: 100%" />
      </label>
      <button :disabled="loading" @click="handleDerive">
        {{ loading ? 'Deriving...' : 'Derive Keys & Generate Address' }}
      </button>

      <div v-if="error" style="color: red">{{ error }}</div>

      <div v-if="keys" style="margin-top: 1rem">
        <h3>Keys</h3>
        <pre>{{
          JSON.stringify(keys, (_, v) => (v instanceof Uint8Array ? Array.from(v) : v), 2)
        }}</pre>
      </div>

      <div v-if="stealthAddress" style="margin-top: 1rem">
        <h3>Stealth Address</h3>
        <pre>{{
          JSON.stringify(stealthAddress, (_, v) => (v instanceof Uint8Array ? Array.from(v) : v), 2)
        }}</pre>
      </div>

      <div v-if="metaAddress" style="margin-top: 1rem">
        <h3>Meta Address</h3>
        <code>{{ metaAddress }}</code>
        <button @click="handleDecode">Decode</button>
      </div>

      <div v-if="decoded" style="margin-top: 1rem">
        <h3>Decoded Meta Address</h3>
        <pre>{{
          JSON.stringify(decoded, (_, v) => (v instanceof Uint8Array ? Array.from(v) : v), 2)
        }}</pre>
      </div>
    </section>
  </div>
</template>
