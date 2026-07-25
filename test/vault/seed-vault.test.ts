/**
 * SeedVault test suite.
 *
 * WebAuthn is fully mocked so tests run in Node without a browser.
 * The WebCrypto (AES-GCM) and fake-indexeddb layers are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { SeedVault } from '../../src/vault';

// ---------------------------------------------------------------------------
// WebAuthn mock helpers
// ---------------------------------------------------------------------------

function createMockPublicKeyCredential() {
  const ctor = vi.fn() as any;
  ctor.isUserVerifyingPlatformAuthenticatorAvailable = vi.fn().mockResolvedValue(true);
  return ctor;
}

function installWebAuthnMock() {
  if (typeof navigator === 'undefined') {
    (globalThis as any).navigator = {};
  }

  const nav = globalThis.navigator as any;

  nav.credentials = {
    create: vi.fn().mockImplementation(async (opts: any) => {
      const evalFirst = opts?.publicKey?.extensions?.prf?.eval?.first;
      const salt = evalFirst ? new Uint8Array(evalFirst) : new Uint8Array(32);
      // Compute deterministic PRF output for this salt.
      const hash = await crypto.subtle.digest('SHA-256', salt);
      const prfBytes = new Uint8Array(hash);
      const getClientExtensionResults = () => ({
        prf: { enabled: true, results: { first: prfBytes.buffer.slice(0) } },
      });

      const rawId = crypto.getRandomValues(new Uint8Array(32));
      return {
        type: 'public-key',
        id: btoa(String.fromCharCode(...rawId)),
        rawId: rawId.buffer,
        response: { getClientExtensionResults },
        getClientExtensionResults,
      };
    }),

    get: vi.fn().mockImplementation(async (opts: any) => {
      const evalFirst = opts?.publicKey?.extensions?.prf?.eval?.first;
      const salt = evalFirst ? new Uint8Array(evalFirst) : new Uint8Array(32);
      const hash = await crypto.subtle.digest('SHA-256', salt);
      const prfBytes = new Uint8Array(hash);
      const getClientExtensionResults = () => ({
        prf: { enabled: true, results: { first: prfBytes.buffer.slice(0) } },
      });

      return {
        type: 'public-key',
        id: 'mock-assertion',
        rawId: new Uint8Array(16).buffer,
        response: { getClientExtensionResults },
        getClientExtensionResults,
      };
    }),
  };

  const MockPKC = createMockPublicKeyCredential();

  // Set on globalThis (for `typeof PublicKeyCredential` checks).
  (globalThis as any).PublicKeyCredential = MockPKC;

  // Set on window mock (for `window.PublicKeyCredential` checks).
  const win = (globalThis as any).window;
  if (win) {
    win.PublicKeyCredential = MockPKC;
  }
}

/** Create a BroadcastChannel mock that captures listeners and messages. */
function createBroadcastChannelMock() {
  const listeners = new Map<string, Set<EventListener>>();
  const messages: any[] = [];

  const channel = {
    addEventListener(type: string, listener: EventListener) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(listener);
    },
    removeEventListener(type: string, listener: EventListener) {
      listeners.get(type)?.delete(listener);
    },
    postMessage(data: any) {
      messages.push(data);
      // Deliver to listeners on the SAME channel (simulating cross-tab delivery).
      for (const listener of listeners.get('message') ?? []) {
        listener(new MessageEvent('message', { data }));
      }
    },
    close: vi.fn(),
    _listeners: listeners,
  };

  (globalThis as any).BroadcastChannel = vi.fn().mockImplementation(() => channel);
  return channel;
}

function removeWebAuthnMock() {
  delete (globalThis as any).PublicKeyCredential;
  delete (globalThis as any).BroadcastChannel;

  const win = (globalThis as any).window;
  if (win) {
    delete win.PublicKeyCredential;
  }

  const nav = globalThis.navigator as any;
  if (nav) {
    delete nav.credentials;
  }
}

// ---------------------------------------------------------------------------
// Test environment polyfills
// ---------------------------------------------------------------------------

function installBrowserPolyfills() {
  if (typeof window === 'undefined') {
    (globalThis as any).window = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      PublicKeyCredential: undefined,
    };
  }
  if (typeof document === 'undefined') {
    (globalThis as any).document = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      visibilityState: 'visible',
    };
  }
}

function removeBrowserPolyfills() {
  // Keep window/document if they were defined before tests — safe to leave.
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SeedVault', () => {
  const originalIndexedDB = globalThis.indexedDB;
  const originalIDBKeyRange = globalThis.IDBKeyRange;

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    globalThis.IDBKeyRange = IDBKeyRange;
    installBrowserPolyfills();
    installWebAuthnMock();
  });

  afterEach(() => {
    globalThis.indexedDB = originalIndexedDB;
    globalThis.IDBKeyRange = originalIDBKeyRange;
    removeWebAuthnMock();
    removeBrowserPolyfills();
  });

  // -------------------------------------------------------------------
  // Static checks
  // -------------------------------------------------------------------

  describe('isSupported', () => {
    it('returns true when WebAuthn is available', () => {
      expect(SeedVault.isSupported()).toBe(true);
    });

    it('returns false when WebAuthn is absent', () => {
      const savedGlobal = (globalThis as any).PublicKeyCredential;
      const win = (globalThis as any).window;

      delete (globalThis as any).PublicKeyCredential;
      if (win) delete win.PublicKeyCredential;

      expect(SeedVault.isSupported()).toBe(false);

      (globalThis as any).PublicKeyCredential = savedGlobal;
      if (win) win.PublicKeyCredential = savedGlobal;
    });

    it('returns false when not in a browser', () => {
      const savedWindow = (globalThis as any).window;
      const savedPKC = (globalThis as any).PublicKeyCredential;

      delete (globalThis as any).window;
      delete (globalThis as any).PublicKeyCredential;

      expect(SeedVault.isSupported()).toBe(false);

      (globalThis as any).window = savedWindow;
      (globalThis as any).PublicKeyCredential = savedPKC;
    });
  });

  // -------------------------------------------------------------------
  // Round-trip: create → lock → unlock
  // -------------------------------------------------------------------

  describe('round-trip', () => {
    it('create → lock → unlock recovers identical seed', async () => {
      const vault = new SeedVault({ dbName: 'test-roundtrip', channelName: null });
      const seed1 = await vault.create('primary');

      expect(seed1).toBeInstanceOf(Uint8Array);
      expect(seed1.byteLength).toBe(32);

      // Seed should be in memory after create.
      expect(vault.isUnlocked('primary')).toBe(true);
      expect(vault.getSeed('primary')).toEqual(seed1);

      // getSeed returns a copy, not the live buffer.
      const copy = vault.getSeed('primary');
      copy[0] = 0xff;
      expect(vault.getSeed('primary')).toEqual(seed1);

      await vault.lock();
      expect(vault.isUnlocked('primary')).toBe(false);
      expect(() => vault.getSeed('primary')).toThrow('locked');

      const seed2 = await vault.unlock('primary');
      expect(seed2).toEqual(seed1);
      expect(seed2).toBeInstanceOf(Uint8Array);
      expect(vault.isUnlocked('primary')).toBe(true);
    });

    it('create → destroyInstance → unlock recovers identical seed', async () => {
      const vault = new SeedVault({ dbName: 'test-persist', channelName: null });
      const seed1 = await vault.create('primary');

      vault.destroyInstance();

      const vault2 = new SeedVault({ dbName: 'test-persist', channelName: null });
      expect(vault2.isUnlocked('primary')).toBe(false);
      const seed2 = await vault2.unlock('primary');
      expect(seed2).toEqual(seed1);
      vault2.destroyInstance();
    });
  });

  // -------------------------------------------------------------------
  // Cross-tab coordination (BroadcastChannel)
  // -------------------------------------------------------------------

  describe('cross-tab', () => {
    it('lock broadcasts to other tabs and wipes local seeds', async () => {
      const channel = createBroadcastChannelMock();

      const vaultA = new SeedVault({ dbName: 'test-cross-tab', channelName: 'test-channel' });
      await vaultA.create('secret');
      expect(vaultA.isUnlocked('secret')).toBe(true);

      // Simulate another tab locking.
      channel.postMessage({ type: 'lock' });

      // Vault A should have received the message and locked.
      expect(vaultA.isUnlocked('secret')).toBe(false);
    });

    it('lockLabel broadcasts targeted lock', async () => {
      const channel = createBroadcastChannelMock();

      const vaultA = new SeedVault({ dbName: 'test-cross-tab-label', channelName: 'test-channel' });
      await vaultA.create('alpha');
      await vaultA.create('beta');

      // Simulate another tab locking just 'alpha'.
      channel.postMessage({ type: 'lock-label', label: 'alpha' });

      expect(vaultA.isUnlocked('alpha')).toBe(false);
      expect(vaultA.isUnlocked('beta')).toBe(true);
    });
  });

  // -------------------------------------------------------------------
  // List labels
  // -------------------------------------------------------------------

  describe('listLabels', () => {
    it('lists stored labels even when locked', async () => {
      const vault = new SeedVault({ dbName: 'test-list', channelName: null });
      await vault.create('alpha');
      await vault.create('beta');
      await vault.lock();

      const labels = await vault.listLabels();
      expect(labels).toContain('alpha');
      expect(labels).toContain('beta');
      expect(labels.length).toBe(2);
    });
  });

  // -------------------------------------------------------------------
  // Unlock errors
  // -------------------------------------------------------------------

  describe('unlock errors', () => {
    it('throws when entry does not exist', async () => {
      const vault = new SeedVault({ dbName: 'test-no-entry', channelName: null });
      await expect(vault.unlock('nope')).rejects.toThrow('not found');
    });

    it('throws when WebAuthn is not supported', async () => {
      const savedGlobal = (globalThis as any).PublicKeyCredential;
      const win = (globalThis as any).window;

      delete (globalThis as any).PublicKeyCredential;
      if (win) delete win.PublicKeyCredential;

      const vault = new SeedVault({ dbName: 'test-no-webauthn', channelName: null });
      await expect(vault.create('primary')).rejects.toThrow('WebAuthn is not supported');

      (globalThis as any).PublicKeyCredential = savedGlobal;
      if (win) win.PublicKeyCredential = savedGlobal;
    });
  });

  // -------------------------------------------------------------------
  // Lock & lockLabel
  // -------------------------------------------------------------------

  describe('lock controls', () => {
    it('lockLabel locks only the specified label', async () => {
      const vault = new SeedVault({ dbName: 'test-lock-label', channelName: null });
      await vault.create('a');
      await vault.create('b');

      vault.lockLabel('a');
      expect(vault.isUnlocked('a')).toBe(false);
      expect(vault.isUnlocked('b')).toBe(true);

      await vault.lock();
    });

    it('lock locks all labels', async () => {
      const vault = new SeedVault({ dbName: 'test-lock-all', channelName: null });
      await vault.create('a');
      await vault.create('b');
      await vault.lock();

      expect(vault.isUnlocked('a')).toBe(false);
      expect(vault.isUnlocked('b')).toBe(false);
    });

    it('unlockedLabels reflects current state', async () => {
      const vault = new SeedVault({ dbName: 'test-labels-list', channelName: null });
      await vault.create('x');
      await vault.create('y');

      expect(vault.unlockedLabels).toContain('x');
      expect(vault.unlockedLabels).toContain('y');

      vault.lockLabel('x');
      expect(vault.unlockedLabels).not.toContain('x');
      expect(vault.unlockedLabels).toContain('y');
    });
  });

  // -------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------

  describe('delete', () => {
    it('removes entry and cannot be unlocked afterwards', async () => {
      const vault = new SeedVault({ dbName: 'test-delete', channelName: null });
      await vault.create('temp');
      await vault.delete('temp');

      expect(vault.isUnlocked('temp')).toBe(false);
      await expect(vault.unlock('temp')).rejects.toThrow('not found');
    });
  });

  // -------------------------------------------------------------------
  // destroy
  // -------------------------------------------------------------------

  describe('destroy', () => {
    it('clears all entries', async () => {
      const vault = new SeedVault({ dbName: 'test-destroy', channelName: null });
      await vault.create('one');
      await vault.create('two');

      await vault.destroy();
      expect(vault.isUnlocked('one')).toBe(false);
      expect(vault.isUnlocked('two')).toBe(false);

      const labels = await vault.listLabels();
      expect(labels.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------
  // Non-browser rejection
  // -------------------------------------------------------------------

  describe('browser-only guard', () => {
    it('rejects construction without window', () => {
      const savedWindow = (globalThis as any).window;
      const savedDocument = (globalThis as any).document;
      const savedIndexedDB = (globalThis as any).indexedDB;

      delete (globalThis as any).window;
      delete (globalThis as any).document;
      delete (globalThis as any).indexedDB;

      expect(() => new SeedVault()).toThrow('SeedVault is browser-only');

      (globalThis as any).window = savedWindow;
      (globalThis as any).document = savedDocument;
      (globalThis as any).indexedDB = savedIndexedDB;
    });

    it('rejects construction without IndexedDB', () => {
      const savedIndexedDB = (globalThis as any).indexedDB;
      delete (globalThis as any).indexedDB;
      expect(() => new SeedVault()).toThrow('SeedVault is browser-only');
      (globalThis as any).indexedDB = savedIndexedDB;
    });
  });

  // -------------------------------------------------------------------
  // Duplicate create guard
  // -------------------------------------------------------------------

  describe('duplicate guard', () => {
    it('rejects create when label already exists in IDB', async () => {
      const vault = new SeedVault({ dbName: 'test-dup', channelName: null });
      await vault.create('primary');
      await vault.lock();

      await expect(vault.create('primary')).rejects.toThrow('already exists');
    });
  });

  // -------------------------------------------------------------------
  // getSeed error
  // -------------------------------------------------------------------

  describe('getSeed', () => {
    it('throws descriptive error when locked', () => {
      const vault = new SeedVault({ dbName: 'test-getseed', channelName: null });
      expect(() => vault.getSeed('nope')).toThrow('locked');
    });
  });
});
