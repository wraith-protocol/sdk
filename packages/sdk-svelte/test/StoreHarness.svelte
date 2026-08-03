<script lang="ts">
  import type { Readable } from 'svelte/store';

  let {
    value,
    run,
  }: {
    value: Readable<unknown>;
    run?: () => unknown | Promise<unknown>;
  } = $props();

  function serialize(current: unknown): string {
    return JSON.stringify(current, (_, item) => (typeof item === 'bigint' ? item.toString() : item));
  }
</script>

{#if run}
  <button type="button" onclick={() => void run()}>Run</button>
{/if}
<output data-testid="value">{serialize($value)}</output>
