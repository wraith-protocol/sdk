import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { KeyVault } from '../../src/vault';

type Listener = (...args: any[]) => void;

function createEventTarget() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    addEventListener(type: string, listener: Listener) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(listener);
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event: { type: string }) {
      for (const listener of listeners.get(event.type) ?? []) {
        listener(event);
      }
    },
    clear() {
      listeners.clear();
    },
  };
}

describe('KeyVault', () => {
  const originalIndexedDB = globalThis.indexedDB;
  const originalIDBKeyRange = globalThis.IDBKeyRange;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  let windowTarget: ReturnType<typeof createEventTarget> & Record<string, any>;
  let documentTarget: ReturnType<typeof createEventTarget> & Record<string, any>;

  beforeEach(() => {
    windowTarget = createEventTarget() as ReturnType<typeof createEventTarget> & Record<string, any>;
    documentTarget = createEventTarget() as ReturnType<typeof createEventTarget> & Record<string, any>;
    documentTarget.visibilityState = 'visible';

    globalThis.indexedDB = new IDBFactory();
    globalThis.IDBKeyRange = IDBKeyRange;
    globalThis.window = windowTarget as any;
    globalThis.document = documentTarget as any;
  });

  afterEach(() => {
    vi.useRealTimers();
    windowTarget?.clear?.();
    documentTarget?.clear?.();
    globalThis.indexedDB = originalIndexedDB;
    globalThis.IDBKeyRange = originalIDBKeyRange;
    globalThis.window = originalWindow as any;
    globalThis.document = originalDocument as any;
  });

  it('unlocks, stores, and retrieves structured key material', async () => {
    const vault = new KeyVault({
      dbName: 'wraith-vault-test',
      iterations: 1000,
      idleTimeoutMs: null,
    });

    const payload = {
      spendingKey: '0x1234',
      viewingKey: new Uint8Array([1, 2, 3, 4]),
      spendingScalar: 42n,
      nested: { label: 'primary' },
    };

    await vault.unlock('correct horse battery staple');
    await vault.put('alice', payload);

    const stored = await vault.get<typeof payload>('alice');
    expect(stored).toEqual(payload);
    expect(stored?.viewingKey).toBeInstanceOf(Uint8Array);
    expect(stored?.spendingScalar).toBe(42n);
    await vault.lock();
  });

  it('keeps ciphertext unreadable at rest', async () => {
    const vault = new KeyVault({
      dbName: 'wraith-vault-test',
      iterations: 1000,
      idleTimeoutMs: null,
    });

    await vault.unlock('correct horse battery staple');
    await vault.put('alice', { hello: 'world' });

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('wraith-vault-test');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const raw = await new Promise<any>((resolve, reject) => {
      const tx = db.transaction('entries', 'readonly');
      const req = tx.objectStore('entries').get('alice');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    expect(raw.ciphertext).not.toContain('world');
    expect(raw.ciphertext).not.toContain('hello');
    expect(raw.iv).toMatch(/^[A-Za-z0-9+/=]+$/);
    await vault.lock();
  });

  it('locks on blur and hides locked state from get/put', async () => {
    const vault = new KeyVault({
      dbName: 'wraith-vault-test',
      iterations: 1000,
      idleTimeoutMs: null,
    });

    await vault.unlock('correct horse battery staple');
    windowTarget.dispatchEvent({ type: 'blur' });
    await Promise.resolve();

    await expect(vault.get('alice')).rejects.toThrow('KeyVault is locked');
    await expect(vault.put('alice', { hello: 'world' })).rejects.toThrow('KeyVault is locked');
  });

  it('auto-locks after inactivity when configured', async () => {
    const vault = new KeyVault({
      dbName: 'wraith-vault-test',
      iterations: 1000,
      idleTimeoutMs: 10,
      lockOnBlur: false,
      lockOnVisibilityChange: false,
    });

    await vault.unlock('correct horse battery staple');
    await new Promise((resolve) => setTimeout(resolve, 25));

    await expect(vault.get('alice')).rejects.toThrow('KeyVault is locked');
    await vault.lock();
  });

  it('rejects wrong passphrases', async () => {
    const vault = new KeyVault({
      dbName: 'wraith-vault-test',
      iterations: 1000,
      idleTimeoutMs: null,
    });

    await vault.unlock('correct horse battery staple');
    await vault.lock();

    const secondVault = new KeyVault({
      dbName: 'wraith-vault-test',
      iterations: 1000,
      idleTimeoutMs: null,
    });

    await expect(secondVault.unlock('wrong passphrase')).rejects.toThrow(
      'Unable to unlock KeyVault',
    );
    await secondVault.lock();
  });

  it('rejects non-browser environments at construction time', () => {
    const savedWindow = globalThis.window;
    const savedDocument = globalThis.document;
    const savedIndexedDB = globalThis.indexedDB;

    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).indexedDB;

    expect(() => new KeyVault()).toThrow('KeyVault is browser-only');

    globalThis.window = savedWindow as any;
    globalThis.document = savedDocument as any;
    globalThis.indexedDB = savedIndexedDB;
  });
});
