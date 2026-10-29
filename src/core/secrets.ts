/**
 * Encrypted-at-rest storage for the user's own API keys, in the browser.
 *
 * Threat model, stated plainly: secrets are AES-GCM encrypted with a
 * non-extractable key that lives in IndexedDB on this origin. That keeps a
 * key out of plain-text storage files and casual inspection, and lets a
 * secret be exported nowhere. It does not protect against code running on
 * this same origin, which can decrypt what it can read. Nothing here ever
 * logs a secret or sends it anywhere; providers receive it per request.
 */

export interface SecretStore {
  get(name: string): Promise<string | null>
  set(name: string, value: string): Promise<void>
  delete(name: string): Promise<void>
  /** Names of stored secrets; values stay encrypted. */
  list(): Promise<string[]>
  close(): void
}

const DB_VERSION = 1
const KEYS = 'keys'
const SECRETS = 'secrets'
const MAIN_KEY = 'main'

interface SecretRecord {
  name: string
  iv: Uint8Array<ArrayBuffer>
  ciphertext: ArrayBuffer
}

export async function openSecretStore(
  dbName = 'voxnote-secrets',
  factory: IDBFactory = indexedDB,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<SecretStore> {
  const db = await openDatabase(dbName, factory)
  const key = await loadOrCreateKey(db, subtle)
  return new IndexedDbSecretStore(db, key, subtle)
}

function openDatabase(
  dbName: string,
  factory: IDBFactory,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(dbName, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(KEYS)) db.createObjectStore(KEYS)
      if (!db.objectStoreNames.contains(SECRETS)) {
        db.createObjectStore(SECRETS, { keyPath: 'name' })
      }
    }
    request.onerror = () => reject(toError(request.error, 'open'))
    request.onblocked = () =>
      reject(new Error('IndexedDB open is blocked by another connection'))
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => db.close()
      resolve(db)
    }
  })
}

async function loadOrCreateKey(
  db: IDBDatabase,
  subtle: SubtleCrypto,
): Promise<CryptoKey> {
  const existing = await run(db, KEYS, 'readonly', (s) => s.get(MAIN_KEY))
  if (existing !== undefined) {
    if (!isCryptoKey(existing)) {
      throw new Error('Corrupt secret store: the encryption key is unreadable')
    }
    return existing
  }
  const key = await subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // never extractable: the key cannot leave this browser
    ['encrypt', 'decrypt'],
  )
  // `add`, not `put`: if another tab created a key meanwhile, keep theirs.
  try {
    await run(db, KEYS, 'readwrite', (s) => s.add(key, MAIN_KEY))
  } catch {
    const theirs = await run(db, KEYS, 'readonly', (s) => s.get(MAIN_KEY))
    if (!isCryptoKey(theirs)) {
      throw new Error('Could not create or read the secret store key')
    }
    return theirs
  }
  return key
}

class IndexedDbSecretStore implements SecretStore {
  private readonly db: IDBDatabase
  private readonly key: CryptoKey
  private readonly subtle: SubtleCrypto

  constructor(db: IDBDatabase, key: CryptoKey, subtle: SubtleCrypto) {
    this.db = db
    this.key = key
    this.subtle = subtle
  }

  async get(name: string): Promise<string | null> {
    const record: unknown = await run(this.db, SECRETS, 'readonly', (s) =>
      s.get(name),
    )
    if (record === undefined) return null
    if (!isSecretRecord(record) || record.name !== name) {
      throw new Error(`Corrupt secret record for "${name}"`)
    }
    const plain = await this.subtle.decrypt(
      { name: 'AES-GCM', iv: record.iv, additionalData: encode(name) },
      this.key,
      record.ciphertext,
    )
    return new TextDecoder().decode(plain)
  }

  async set(name: string, value: string): Promise<void> {
    if (name === '') throw new Error('A secret needs a name')
    if (value === '') throw new Error('Refusing to store an empty secret')
    const iv = crypto.getRandomValues(
      new Uint8Array(12),
    ) as Uint8Array<ArrayBuffer>
    const ciphertext = await this.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: encode(name) },
      this.key,
      encode(value),
    )
    const record: SecretRecord = { name, iv, ciphertext }
    await run(this.db, SECRETS, 'readwrite', (s) => s.put(record))
  }

  async delete(name: string): Promise<void> {
    await run(this.db, SECRETS, 'readwrite', (s) => s.delete(name))
  }

  async list(): Promise<string[]> {
    const keys = await run(this.db, SECRETS, 'readonly', (s) => s.getAllKeys())
    return keys.map(String).sort()
  }

  close(): void {
    this.db.close()
  }
}

function encode(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>
}

function isCryptoKey(value: unknown): value is CryptoKey {
  return (
    typeof value === 'object' &&
    value !== null &&
    'algorithm' in value &&
    'usages' in value &&
    (value as CryptoKey).extractable === false
  )
}

function isSecretRecord(value: unknown): value is SecretRecord {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  return (
    typeof r.name === 'string' &&
    r.iv instanceof Uint8Array &&
    r.iv.length === 12 &&
    r.ciphertext instanceof ArrayBuffer
  )
}

/** One request in its own transaction; settles when it commits. */
function run<T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode)
    let result: T | undefined
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    let request: IDBRequest<T>
    try {
      request = operation(transaction.objectStore(storeName))
    } catch (err: unknown) {
      transaction.abort()
      fail(err instanceof Error ? err : new Error(String(err)))
      return
    }
    request.onsuccess = () => {
      result = request.result
    }
    request.onerror = () => fail(toError(request.error, mode))
    transaction.onabort = () => fail(toError(transaction.error, 'abort'))
    transaction.onerror = () => fail(toError(transaction.error, mode))
    transaction.oncomplete = () => {
      if (settled) return
      settled = true
      resolve(result as T)
    }
  })
}

function toError(error: DOMException | null, context: string): Error {
  return new Error(
    `IndexedDB ${context} failed: ${error?.message ?? 'unknown error'}`,
  )
}
