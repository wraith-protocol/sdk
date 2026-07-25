// ---------------------------------------------------------------------------
// KeyVault — passphrase-based encrypted key-value store (existing)
// ---------------------------------------------------------------------------

const DB_NAME = 'wraith-vault';
const DB_VERSION = 1;
const STORE_META = 'meta';
const STORE_ENTRIES = 'entries';
const VAULT_META_KEY = 'vault';
const DEFAULT_PBKDF2_ITERATIONS = 210_000;
const DEFAULT_IDLE_LOCK_MS = 5 * 60 * 1000;

export interface KeyVaultOptions {
  dbName?: string;
  iterations?: number;
  idleTimeoutMs?: number | null;
  lockOnBlur?: boolean;
  lockOnVisibilityChange?: boolean;
}

interface VaultMetaRecord {
  key: typeof VAULT_META_KEY;
  salt: string;
  checkIv: string;
  checkCiphertext: string;
  iterations: number;
}

interface VaultEntryRecord {
  key: string;
  iv: string;
  ciphertext: string;
}

interface ResolvedOptions {
  dbName: string;
  iterations: number;
  idleTimeoutMs: number | null;
  lockOnBlur: boolean;
  lockOnVisibilityChange: boolean;
}

function resolveOptions(options: KeyVaultOptions = {}): ResolvedOptions {
  return {
    dbName: options.dbName ?? DB_NAME,
    iterations: options.iterations ?? DEFAULT_PBKDF2_ITERATIONS,
    idleTimeoutMs:
      options.idleTimeoutMs === undefined ? DEFAULT_IDLE_LOCK_MS : options.idleTimeoutMs,
    lockOnBlur: options.lockOnBlur ?? true,
    lockOnVisibilityChange: options.lockOnVisibilityChange ?? true,
  };
}

function assertBrowserSupport(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('KeyVault is browser-only and requires window and document.');
  }
  if (typeof indexedDB === 'undefined') {
    throw new Error(
      'KeyVault is browser-only and requires IndexedDB. Use the browser runtime or bundle.',
    );
  }
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('KeyVault requires WebCrypto (crypto.subtle).');
  }
}

function assertUnlocked(key: CryptoKey | null): asserts key is CryptoKey {
  if (!key) {
    throw new Error('KeyVault is locked. Call vault.unlock(passphrase) first.');
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodeValue(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { __vaultType: 'Uint8Array', data: bytesToBase64(value) };
  }

  if (value instanceof ArrayBuffer) {
    return { __vaultType: 'ArrayBuffer', data: bytesToBase64(new Uint8Array(value)) };
  }

  if (value instanceof Date) {
    return { __vaultType: 'Date', data: value.toISOString() };
  }

  if (typeof value === 'bigint') {
    return { __vaultType: 'bigint', data: value.toString() };
  }

  if (Array.isArray(value)) {
    return value.map((item) => encodeValue(item));
  }

  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = encodeValue(item);
    }
    return out;
  }

  return value;
}

function decodeValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => decodeValue(item));
  }

  const record = value as Record<string, unknown>;
  if (record.__vaultType === 'Uint8Array') {
    return base64ToBytes(String(record.data));
  }

  if (record.__vaultType === 'ArrayBuffer') {
    return base64ToBytes(String(record.data)).buffer;
  }

  if (record.__vaultType === 'Date') {
    return new Date(String(record.data));
  }

  if (record.__vaultType === 'bigint') {
    return BigInt(String(record.data));
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (key === '__vaultType') continue;
    out[key] = decodeValue(item);
  }
  return out;
}

function toBytes(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

async function deriveAesKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const passphraseKey = await crypto.subtle.importKey(
    'raw',
    toBytes(passphrase) as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    passphraseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptJson(
  key: CryptoKey,
  payload: unknown,
): Promise<{ iv: string; ciphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = toBytes(JSON.stringify(encodeValue(payload)));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    plaintext as BufferSource,
  );
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}

async function decryptJson<T>(key: CryptoKey, iv: string, ciphertext: string): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv) as BufferSource },
    key,
    base64ToBytes(ciphertext) as BufferSource,
  );
  return decodeValue(JSON.parse(new TextDecoder().decode(plaintext))) as T;
}

export class KeyVault {
  private readonly options: ResolvedOptions;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private db: IDBDatabase | null = null;
  private cryptoKey: CryptoKey | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onActivity = () => this.resetIdleTimer();
  private readonly onBlur = () => {
    void this.lock();
  };
  private readonly onVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      void this.lock();
    }
  };

  constructor(options: KeyVaultOptions = {}) {
    assertBrowserSupport();
    this.options = resolveOptions(options);
  }

  async unlock(passphrase: string): Promise<void> {
    const db = await this.openDB();
    const meta = await this.getMeta(db);
    const resolvedMeta = meta ?? (await this.createMeta(db, passphrase, this.options.iterations));

    const salt = base64ToBytes(resolvedMeta.salt);
    const key = await deriveAesKey(passphrase, salt, resolvedMeta.iterations);

    try {
      await decryptJson<unknown>(key, resolvedMeta.checkIv, resolvedMeta.checkCiphertext);
    } catch {
      throw new Error(
        'Unable to unlock KeyVault. The passphrase is incorrect or the vault is corrupt.',
      );
    }

    this.cryptoKey = key;
    this.installAutoLockHooks();
    this.resetIdleTimer();
  }

  async lock(): Promise<void> {
    this.cryptoKey = null;
    this.clearIdleTimer();
    this.removeAutoLockHooks();
    if (this.db) {
      this.db.close();
      this.db = null;
      this.dbPromise = null;
    }
  }

  async put<T>(label: string, keys: T): Promise<void> {
    const key = this.cryptoKey;
    assertUnlocked(key);
    const db = await this.openDB();
    const record = await encryptJson(key, keys);

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_ENTRIES, 'readwrite');
      tx.objectStore(STORE_ENTRIES).put({
        key: label,
        iv: record.iv,
        ciphertext: record.ciphertext,
      } satisfies VaultEntryRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    this.resetIdleTimer();
  }

  async get<T>(label: string): Promise<T | null> {
    const key = this.cryptoKey;
    assertUnlocked(key);
    const db = await this.openDB();
    const record = await new Promise<VaultEntryRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE_ENTRIES, 'readonly');
      const req = tx.objectStore(STORE_ENTRIES).get(label);
      req.onsuccess = () => resolve((req.result as VaultEntryRecord | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });

    if (!record) {
      return null;
    }

    const value = await decryptJson<T>(key, record.iv, record.ciphertext);
    this.resetIdleTimer();
    return value;
  }

  private openDB(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.options.dbName, DB_VERSION);

      req.onupgradeneeded = (evt) => {
        const db = (evt.target as IDBOpenDBRequest).result;
        if (db.objectStoreNames.contains(STORE_META)) {
          db.deleteObjectStore(STORE_META);
        }
        if (db.objectStoreNames.contains(STORE_ENTRIES)) {
          db.deleteObjectStore(STORE_ENTRIES);
        }
        db.createObjectStore(STORE_META, { keyPath: 'key' });
        db.createObjectStore(STORE_ENTRIES, { keyPath: 'key' });
      };

      req.onsuccess = () => {
        this.db = req.result;
        this.db.onclose = () => {
          if (this.db === req.result) {
            this.db = null;
            this.dbPromise = null;
          }
        };
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    });

    return this.dbPromise;
  }

  private async getMeta(db: IDBDatabase): Promise<VaultMetaRecord | null> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const req = tx.objectStore(STORE_META).get(VAULT_META_KEY);
      req.onsuccess = () => resolve((req.result as VaultMetaRecord | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  private async createMeta(
    db: IDBDatabase,
    passphrase: string,
    iterations: number,
  ): Promise<VaultMetaRecord> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveAesKey(passphrase, salt, iterations);
    const check = await encryptJson(key, { ok: true });
    const meta: VaultMetaRecord = {
      key: VAULT_META_KEY,
      salt: bytesToBase64(salt),
      checkIv: check.iv,
      checkCiphertext: check.ciphertext,
      iterations,
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readwrite');
      tx.objectStore(STORE_META).put(meta);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    return meta;
  }

  private installAutoLockHooks(): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.removeEventListener('pointerdown', this.onActivity);
    window.removeEventListener('keydown', this.onActivity);
    window.removeEventListener('scroll', this.onActivity);
    window.removeEventListener('touchstart', this.onActivity);
    window.removeEventListener('mousemove', this.onActivity);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);

    if (this.options.idleTimeoutMs !== null) {
      window.addEventListener('pointerdown', this.onActivity, { passive: true });
      window.addEventListener('keydown', this.onActivity, { passive: true });
      window.addEventListener('scroll', this.onActivity, { passive: true });
      window.addEventListener('touchstart', this.onActivity, { passive: true });
      window.addEventListener('mousemove', this.onActivity, { passive: true });
    }

    if (this.options.lockOnBlur) {
      window.addEventListener('blur', this.onBlur);
    }

    if (this.options.lockOnVisibilityChange) {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  private removeAutoLockHooks(): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.removeEventListener('pointerdown', this.onActivity);
    window.removeEventListener('keydown', this.onActivity);
    window.removeEventListener('scroll', this.onActivity);
    window.removeEventListener('touchstart', this.onActivity);
    window.removeEventListener('mousemove', this.onActivity);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    if (this.options.idleTimeoutMs === null || typeof window === 'undefined') {
      return;
    }

    this.idleTimer = setTimeout(() => {
      void this.lock();
    }, this.options.idleTimeoutMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

// ---------------------------------------------------------------------------
// SeedVault — WebAuthn-unlocked encrypted seed vault
// ---------------------------------------------------------------------------

import { aesEncrypt, aesDecrypt, importAesKey } from './aes';
import { isWebAuthnSupported, createCredential, getAssertion } from './webauthn';

const SEED_VAULT_DB_NAME = 'wraith-seed-vault';
const SEED_VAULT_DB_VERSION = 1;
const SEED_VAULT_STORE = 'entries';
const SEED_VAULT_CHANNEL = 'wraith-seed-vault';
const SEED_BYTE_LENGTH = 32;

/** Message type for cross-tab coordination over BroadcastChannel. */
type SeedVaultMessage = { type: 'lock' } | { type: 'lock-label'; label: string };

interface SeedVaultEntry {
  label: string;
  credentialId: string;
  salt: string;
  iv: string;
  ciphertext: string;
}

export interface SeedVaultOptions {
  /** IndexedDB database name (default: `"wraith-seed-vault"`). */
  dbName?: string;
  /**
   * BroadcastChannel name for cross-tab lock coordination.
   * Set to `null` to disable cross-tab locking.
   * (default: `"wraith-seed-vault"`).
   */
  channelName?: string | null;
}

export interface SeedVaultCreateOptions {
  /** Relying Party id for WebAuthn (default: `"wraith-protocol"`). */
  rpId?: string;
  /** User display name shown in the browser UI. */
  userName?: string;
}

export interface SeedVaultUnlockOptions {
  /** Relying Party id for WebAuthn (must match the create call). */
  rpId?: string;
}

function assertSeedVaultBrowser(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('SeedVault is browser-only and requires window and document.');
  }
  if (typeof indexedDB === 'undefined') {
    throw new Error('SeedVault is browser-only and requires IndexedDB.');
  }
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('SeedVault requires WebCrypto (crypto.subtle).');
  }
}

/**
 * WebAuthn-unlocked encrypted seed vault.
 *
 * Stores a 32-byte seed encrypted at rest in IndexedDB. The AES-256-GCM
 * encryption key is derived from a WebAuthn PRF assertion, which means the
 * user must touch their platform authenticator (Touch ID, Windows Hello, etc.)
 * every time the vault is unlocked.
 *
 * **Cross-tab:** lock state is coordinated across tabs via BroadcastChannel.
 * Locking in one tab locks all tabs. Tab-close also triggers a lock.
 *
 * **Not a wallet** — the SeedVault is for storing seed material only,
 * not for custody of funds or transaction signing.
 */
export class SeedVault {
  /** Check whether WebAuthn with PRF is available in the current browser. */
  static isSupported(): boolean {
    return isWebAuthnSupported();
  }

  private readonly dbName: string;
  private readonly channel: BroadcastChannel | null;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private db: IDBDatabase | null = null;
  private readonly seeds = new Map<string, Uint8Array>();
  private readonly onChannelMessage: (event: MessageEvent<SeedVaultMessage>) => void;
  private readonly onPageHide: () => void;

  constructor(options: SeedVaultOptions = {}) {
    assertSeedVaultBrowser();
    this.dbName = options.dbName ?? SEED_VAULT_DB_NAME;

    const channelName =
      options.channelName === undefined ? SEED_VAULT_CHANNEL : options.channelName;
    this.channel =
      typeof BroadcastChannel !== 'undefined' && channelName !== null
        ? new BroadcastChannel(channelName)
        : null;

    this.onChannelMessage = (event: MessageEvent<SeedVaultMessage>) => {
      if (event.data?.type === 'lock') {
        this.lockSilent();
      } else if (event.data?.type === 'lock-label') {
        this.seeds.delete(event.data.label);
      }
    };

    if (this.channel) {
      this.channel.addEventListener('message', this.onChannelMessage);
    }

    this.onPageHide = () => {
      this.lockSilent();
    };

    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('beforeunload', this.onPageHide);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Create a new vault entry.
   *
   * Generates a random 32-byte seed, registers a WebAuthn credential with
   * the PRF extension, encrypts the seed with the derived key, and persists
   * the ciphertext to IndexedDB.
   *
   * The seed is **returned to the caller** so they can derive stealth keys
   * immediately. It is also kept in the in-memory cache until {@link lock}
   * is called.
   *
   * @param label   - Human-readable key for the entry.
   * @param options - Optional WebAuthn configuration.
   * @returns The 32-byte seed.
   */
  async create(label: string, options: SeedVaultCreateOptions = {}): Promise<Uint8Array> {
    if (!isWebAuthnSupported()) {
      throw new Error('WebAuthn is not supported in this browser.');
    }

    if (this.seeds.has(label)) {
      throw new Error(`SeedVault entry "${label}" is already unlocked. Lock it first.`);
    }

    // Check whether a stored entry already exists under this label.
    const existing = await this.getEntry(label);
    if (existing) {
      throw new Error(
        `SeedVault entry "${label}" already exists. Use unlock() to access it or delete() to remove it.`,
      );
    }

    const seed = crypto.getRandomValues(new Uint8Array(SEED_BYTE_LENGTH));
    const salt = crypto.getRandomValues(new Uint8Array(32));

    // Register WebAuthn credential and derive PRF key.
    const { credentialId, prfKey } = await createCredential(salt, options.rpId, options.userName);

    // Encrypt seed with PRF-derived AES key.
    const aesKey = await importAesKey(prfKey);
    const { iv, ciphertext } = await aesEncrypt(aesKey, seed);

    // Persist to IndexedDB.
    const entry: SeedVaultEntry = {
      label,
      credentialId,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(ciphertext),
    };

    await this.putEntry(entry);

    // Cache in memory.
    this.seeds.set(label, seed);

    return seed;
  }

  /**
   * Unlock a vault entry by performing a WebAuthn assertion.
   *
   * The user will be prompted for a biometric or PIN touch. If the assertion
   * succeeds, the PRF-derived key is used to decrypt the stored seed.
   *
   * @param label   - Label of the entry to unlock.
   * @param options - Optional WebAuthn configuration.
   * @returns The decrypted 32-byte seed.
   */
  async unlock(label: string, options: SeedVaultUnlockOptions = {}): Promise<Uint8Array> {
    if (!isWebAuthnSupported()) {
      throw new Error('WebAuthn is not supported in this browser.');
    }

    if (this.seeds.has(label)) {
      return this.seeds.get(label)!;
    }

    const entry = await this.getEntry(label);
    if (!entry) {
      throw new Error(`SeedVault entry "${label}" not found. Use create() to create it first.`);
    }

    const salt = base64ToBytes(entry.salt);

    // Perform WebAuthn assertion to recover PRF key.
    const prfKey = await getAssertion(entry.credentialId, salt, options.rpId);

    // Decrypt.
    const aesKey = await importAesKey(prfKey);
    const iv = base64ToBytes(entry.iv);
    const ciphertext = base64ToBytes(entry.ciphertext);
    const seed = await aesDecrypt(aesKey, iv, ciphertext);

    // Validate seed length.
    if (seed.byteLength !== SEED_BYTE_LENGTH) {
      throw new Error(
        `Decrypted seed has unexpected length ${seed.byteLength} (expected ${SEED_BYTE_LENGTH}). The vault may be corrupt.`,
      );
    }

    this.seeds.set(label, seed);
    return seed;
  }

  /**
   * Return the in-memory seed for a label.
   *
   * @throws If the label has not been unlocked.
   */
  /**
   * Return a **copy** of the in-memory seed for a label.
   *
   * The copy prevents accidental mutation of the cached value.
   *
   * @throws If the label has not been unlocked.
   */
  getSeed(label: string): Uint8Array {
    const seed = this.seeds.get(label);
    if (!seed) {
      throw new Error(`SeedVault entry "${label}" is locked. Call vault.unlock("${label}") first.`);
    }
    return new Uint8Array(seed);
  }

  /** Whether the given label is currently unlocked. */
  isUnlocked(label: string): boolean {
    return this.seeds.has(label);
  }

  /** List all labels currently held in memory. */
  get unlockedLabels(): string[] {
    return Array.from(this.seeds.keys());
  }

  /**
   * Lock the vault — wipe all in-memory seeds and broadcast the lock
   * event to other tabs.
   */
  async lock(): Promise<void> {
    this.seeds.clear();
    this.closeDB();

    if (this.channel) {
      this.channel.postMessage({ type: 'lock' } satisfies SeedVaultMessage);
    }
  }

  /**
   * Lock a single label without affecting other unlocked entries.
   * Broadcasts a targeted lock event so other tabs also drop the label.
   */
  lockLabel(label: string): void {
    this.seeds.delete(label);

    if (this.channel) {
      this.channel.postMessage({ type: 'lock-label', label } satisfies SeedVaultMessage);
    }
  }

  /**
   * List all labels stored in IndexedDB (whether locked or not).
   */
  async listLabels(): Promise<string[]> {
    const db = await this.openDB();

    return new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(SEED_VAULT_STORE, 'readonly');
      const req = tx.objectStore(SEED_VAULT_STORE).getAllKeys();
      req.onsuccess = () => resolve((req.result as string[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Delete a vault entry permanently from IndexedDB.
   *
   * The label does not need to be unlocked first.
   */
  async delete(label: string): Promise<void> {
    this.seeds.delete(label);

    const db = await this.openDB();

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SEED_VAULT_STORE, 'readwrite');
      tx.objectStore(SEED_VAULT_STORE).delete(label);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Delete ALL vault entries and lock immediately.
   *
   * This is destructive and irreversible — the encrypted seeds cannot be
   * recovered unless the user backed up the original seed material.
   */
  async destroy(): Promise<void> {
    this.seeds.clear();

    const db = await this.openDB();

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SEED_VAULT_STORE, 'readwrite');
      tx.objectStore(SEED_VAULT_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    this.closeDB();

    if (this.channel) {
      this.channel.postMessage({ type: 'lock' } satisfies SeedVaultMessage);
    }
  }

  /**
   * Tear down the vault instance.
   *
   * Removes event listeners, closes BroadcastChannel and IndexedDB,
   * and clears in-memory seeds. Call this when you no longer need the vault
   * (e.g. component unmount).
   */
  destroyInstance(): void {
    this.seeds.clear();
    this.closeDB();

    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('beforeunload', this.onPageHide);

    if (this.channel) {
      this.channel.removeEventListener('message', this.onChannelMessage);
      this.channel.close();
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private openDB(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, SEED_VAULT_DB_VERSION);

      req.onupgradeneeded = (evt) => {
        const db = (evt.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(SEED_VAULT_STORE)) {
          db.createObjectStore(SEED_VAULT_STORE, { keyPath: 'label' });
        }
      };

      req.onsuccess = () => {
        this.db = req.result;
        this.db.onclose = () => {
          if (this.db === req.result) {
            this.db = null;
            this.dbPromise = null;
          }
        };
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    });

    return this.dbPromise;
  }

  private closeDB(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.dbPromise = null;
    }
  }

  private async getEntry(label: string): Promise<SeedVaultEntry | null> {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(SEED_VAULT_STORE, 'readonly');
      const req = tx.objectStore(SEED_VAULT_STORE).get(label);
      req.onsuccess = () => resolve((req.result as SeedVaultEntry | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  private async putEntry(entry: SeedVaultEntry): Promise<void> {
    const db = await this.openDB();

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SEED_VAULT_STORE, 'readwrite');
      tx.objectStore(SEED_VAULT_STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private lockSilent(): void {
    this.seeds.clear();
    // Do NOT close IDB on pagehide — the browser is tearing down anyway
    // and closing can cause "blocked" errors during navigation.
  }
}
