/**
 * Local-first persistence of annotations in IndexedDB. Records are validated
 * on the way out; a corrupt record is an error, not something to skip. Writes
 * resolve only once the transaction has committed, so a failed commit (quota,
 * eviction) rejects instead of leaving the UI believing the data is saved.
 */
import { isAnnotation, type Annotation } from './annotations'

export interface AnnotationStore {
  list(documentId: string): Promise<Annotation[]>
  put(annotation: Annotation): Promise<void>
  delete(id: string): Promise<void>
  close(): void
}

const DB_VERSION = 1
const STORE = 'annotations'
const BY_DOCUMENT = 'documentId'

export function openDatabase(
  dbName = 'voxnote',
  factory: IDBFactory = indexedDB,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(dbName, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex(BY_DOCUMENT, 'documentId', { unique: false })
      }
    }
    request.onerror = () => reject(toError(request.error, 'open'))
    request.onblocked = () =>
      reject(new Error('IndexedDB open is blocked by another connection'))
    request.onsuccess = () => {
      const db = request.result
      // Let a future schema upgrade in another tab proceed.
      db.onversionchange = () => db.close()
      resolve(db)
    }
  })
}

export async function openAnnotationStore(
  dbName = 'voxnote',
  factory: IDBFactory = indexedDB,
): Promise<AnnotationStore> {
  return createAnnotationStore(await openDatabase(dbName, factory))
}

export function createAnnotationStore(db: IDBDatabase): AnnotationStore {
  return new IndexedDbAnnotationStore(db)
}

class IndexedDbAnnotationStore implements AnnotationStore {
  private readonly db: IDBDatabase

  constructor(db: IDBDatabase) {
    this.db = db
  }

  list(documentId: string): Promise<Annotation[]> {
    return this.run('readonly', (store) =>
      store.index(BY_DOCUMENT).getAll(documentId),
    ).then((records: unknown[]) => {
      const bad: unknown = records.find((r) => !isAnnotation(r))
      if (bad !== undefined) {
        throw new Error(
          `Corrupt annotation record in IndexedDB: ${JSON.stringify(bad)}`,
        )
      }
      return (records as Annotation[]).sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      )
    })
  }

  put(annotation: Annotation): Promise<void> {
    // Validate at the edge even though the type says it is fine: callers may
    // hand us records parsed from an import file.
    const candidate: unknown = annotation
    if (!isAnnotation(candidate)) {
      return Promise.reject(
        new Error(
          `Refusing to store an invalid annotation: ${JSON.stringify(candidate)}`,
        ),
      )
    }
    return this.run('readwrite', (store) => store.put(annotation)).then(
      () => undefined,
    )
  }

  delete(id: string): Promise<void> {
    return this.run('readwrite', (store) => store.delete(id)).then(
      () => undefined,
    )
  }

  close(): void {
    this.db.close()
  }

  /** Runs one request in its own transaction; settles when it commits. */
  private run<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(STORE, mode)
      const request = operation(transaction.objectStore(STORE))
      let result: T | undefined
      let settled = false
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        reject(error)
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
}

function toError(error: DOMException | null, context: string): Error {
  return new Error(
    `IndexedDB ${context} failed: ${error?.message ?? 'unknown error'}`,
  )
}
