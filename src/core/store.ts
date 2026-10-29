/**
 * Local-first persistence of annotations in IndexedDB. Records are validated
 * on the way out; a corrupt record is an error, not something to skip.
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

export function openAnnotationStore(
  dbName = 'voxnote',
  factory: IDBFactory = indexedDB,
): Promise<AnnotationStore> {
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
    request.onsuccess = () =>
      resolve(new IndexedDbAnnotationStore(request.result))
  })
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

  private run<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(STORE, mode)
      const request = operation(transaction.objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(toError(request.error, mode))
      transaction.onabort = () => reject(toError(transaction.error, 'abort'))
    })
  }
}

function toError(error: DOMException | null, context: string): Error {
  return new Error(
    `IndexedDB ${context} failed: ${error?.message ?? 'unknown error'}`,
  )
}
