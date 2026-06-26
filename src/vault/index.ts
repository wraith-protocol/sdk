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
