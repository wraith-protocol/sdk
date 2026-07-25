// Re-export all composables from sdk-vue with SSR safety wrappers.
// The underlying sdk-vue composables use Vue's ref/readonly which work fine
// on the server — they just hold no browser-specific state.
//
// Heavy crypto work (key derivation, scanning) is synchronous and pure, so
// it runs identically on server and client. Async network operations
// (fetchAnnouncements) are no-ops until called, so they don't execute
// during SSR unless the component explicitly calls them in a server context.

export { useWraith } from '@wraith-protocol/sdk-vue';
export { useStellarStealthKeys } from '@wraith-protocol/sdk-vue';
export { useEvmStealthKeys } from '@wraith-protocol/sdk-vue';
export { useSolanaStealthKeys } from '@wraith-protocol/sdk-vue';
export { useStealthMetaAddress } from '@wraith-protocol/sdk-vue';
export { useScanner } from '@wraith-protocol/sdk-vue';
export type { ChainType } from '@wraith-protocol/sdk-vue';
