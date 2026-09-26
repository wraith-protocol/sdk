# Custom Chain Adapter Example

Demonstrates implementing a third-party chain scanner adapter conforming to the `ChainScannerAdapter` interface and registering it with `scanAll()`.

## Overview

Wraith SDK allows custom chain adapters to be integrated without patching the core SDK.
A custom adapter implements the `ChainScannerAdapter` contract:

```ts
interface ChainScannerAdapter<TItem, TKeys, TMatched, TMetaAddress> {
  id: string;
  scan(source: AsyncIterable<TItem>, keys: TKeys): AsyncGenerator<TMatched>;
  decodeMetaAddress(metaAddress: string): TMetaAddress;
  encodeMetaAddress(spendingPubKey: any, viewingPubKey: any): string;
}
```

## Running the Example

```bash
npm start
```
