// Simple benchmark: compare reading from cache vs streaming fetch
async function* simulatedFetchAnnouncements(total = 1000, page = 100, delayMs = 5) {
  let yielded = 0;
  while (yielded < total) {
    // simulate a network/page delay
    await new Promise((r) => setTimeout(r, delayMs));
    const batch = Array.from({ length: Math.min(page, total - yielded) }, (_, i) => ({
      id: yielded + i,
    }));
    for (const b of batch) yield b;
    yielded += batch.length;
  }
}

async function measureStream(total, page, delayMs) {
  const start = Date.now();
  const arr = [];
  for await (const _ of simulatedFetchAnnouncements(total, page, delayMs)) {
    arr.push(1);
  }
  const ms = Date.now() - start;
  return { ms, items: arr.length };
}

async function measureCacheRead(total) {
  const start = Date.now();
  // simulate immediate cache read
  const arr = Array.from({ length: total }, (_, i) => i);
  const ms = Date.now() - start;
  return { ms, items: arr.length };
}

async function run() {
  const total = 5000;
  const page = 250;
  const delayMs = 3; // simulate RPC page latency

  console.log('Benchmark: simulated announcements:', total);

  const cold = await measureStream(total, page, delayMs);
  console.log('Cold scan (stream) completed:', cold.items, 'items in', cold.ms, 'ms');

  const cached = await measureCacheRead(total);
  console.log('Cached read completed:', cached.items, 'items in', cached.ms, 'ms');

  console.log('Speedup (cold / cached):', (cold.ms / Math.max(1, cached.ms)).toFixed(2), 'x');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
