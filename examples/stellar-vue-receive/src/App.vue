<script setup lang="ts">
import { ref, computed } from 'vue';
import { useStealthKeys, useMetaAddress } from '@wraith-protocol/sdk-vue';
import { bytesToHex } from '@wraith-protocol/sdk/chains/stellar';

const input = ref('');
const deriveError = ref<string | null>(null);

const { keys, deriveKeys, generateAddress, loading, error } = useStealthKeys('stellar');

const { encode, encoded, decoded, decode, detectChain } = useMetaAddress();

function parseHex(hex: string): Uint8Array | null {
  const cleaned = hex.replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]+$/.test(cleaned) || cleaned.length % 2 !== 0) return null;
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
}

function handleDerive() {
  deriveError.value = null;
  const trimmed = input.value.trim();
  if (!trimmed) {
    deriveError.value = 'Please enter a secret key.';
    return;
  }
  const bytes = parseHex(trimmed);
  if (!bytes) {
    deriveError.value = 'Invalid hex string. Must be even-length hex.';
    return;
  }
  if (bytes.length !== 64) {
    deriveError.value = `Expected 64 bytes, got ${bytes.length}.`;
    return;
  }
  try {
    const k = deriveKeys(bytes) as {
      spendingKey: Uint8Array;
      spendingPubKey: Uint8Array;
      viewingKey: Uint8Array;
      viewingPubKey: Uint8Array;
    };
    generateAddress(k.spendingPubKey, k.viewingPubKey);
    encode(k.spendingPubKey, k.viewingPubKey);
  } catch (e) {
    deriveError.value = e instanceof Error ? e.message : 'Key derivation failed.';
  }
}

function safeHex(val: unknown): string {
  if (val instanceof Uint8Array) return bytesToHex(val);
  if (typeof val === 'string') return val;
  return String(val);
}

const metaAddress = computed(() => encoded.value);
const spendingKeyHex = computed(() =>
  keys.value ? safeHex((keys.value as Record<string, unknown>).spendingKey) : '',
);
const viewingPubKeyHex = computed(() =>
  keys.value ? safeHex((keys.value as Record<string, unknown>).viewingPubKey) : '',
);

const replacer = (_: string, v: unknown) => (v instanceof Uint8Array ? Array.from(v).join(',') : v);
</script>

<template>
  <main style="max-width: 640px; margin: 40px auto; font-family: system-ui, sans-serif">
    <h1>Wraith Stellar — Receive Stealth Payments (Vue)</h1>
    <p>
      Enter your 64-byte hex secret key to derive your stealth keys and meta-address. Share the
      meta-address with senders.
    </p>

    <section style="margin: 24px 0">
      <label for="secret" style="display: block; margin-bottom: 8px; font-weight: 600">
        Secret Key (hex, 64 bytes)
      </label>
      <textarea
        id="secret"
        v-model="input"
        rows="3"
        style="width: 100%; font-family: monospace; padding: 8px"
        placeholder="aa... (128 hex chars)"
      />
      <button
        :disabled="loading"
        @click="handleDerive"
        style="margin-top: 8px; padding: 8px 24px; cursor: pointer"
      >
        {{ loading ? 'Deriving...' : 'Derive Stealth Keys' }}
      </button>
    </section>

    <section v-if="deriveError || error" style="color: #c00; margin: 16px 0">
      <strong>Error:</strong> {{ deriveError || error }}
    </section>

    <section
      v-if="keys"
      style="
        background: #f5f5f5;
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 16px;
        margin: 16px 0;
      "
    >
      <h2>Your Stealth Keys</h2>
      <table style="width: 100%; border-collapse: collapse">
        <tbody>
          <tr>
            <td style="padding: 6px 8px; font-weight: 500; white-space: nowrap">
              Spending Secret Key
            </td>
            <td
              style="
                padding: 6px 8px;
                font-family: monospace;
                font-size: 13px;
                word-break: break-all;
              "
            >
              {{ spendingKeyHex }}
            </td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; font-weight: 500; white-space: nowrap">
              Viewing Public Key
            </td>
            <td
              style="
                padding: 6px 8px;
                font-family: monospace;
                font-size: 13px;
                word-break: break-all;
              "
            >
              {{ viewingPubKeyHex }}
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="metaAddress" style="margin-top: 16px">
        <strong>Stealth Meta-Address</strong>
        <pre
          style="
            background: #fff;
            border: 1px solid #ccc;
            border-radius: 4px;
            padding: 12px;
            margin-top: 6px;
            overflow: auto;
            user-select: all;
            cursor: pointer;
          "
          @click="copyToClipboard(metaAddress)"
          title="Click to copy"
          >{{ metaAddress }}</pre
        >
        <p style="font-size: 13px; color: #666">
          Click the meta-address above to copy it. Share this with anyone who wants to send you
          stealth payments.
        </p>

        <hr style="margin: 16px 0" />

        <h3>Decoded Meta Address</h3>
        <button @click="decode(metaAddress)">Decode</button>
        <pre v-if="decoded" style="margin-top: 8px">{{ JSON.stringify(decoded, replacer, 2) }}</pre>
        <p v-if="decoded" style="font-size: 13px; color: #666">
          Chain: {{ detectChain(metaAddress) }}
        </p>
      </div>
    </section>
  </main>
</template>
