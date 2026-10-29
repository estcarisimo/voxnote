/**
 * Local-first persistence of annotations in IndexedDB. Records are validated
 * on the way out; a corrupt record is an error, not something to skip. Writes
 * resolve only once the transaction has committed, so a failed commit (quota,
 * eviction) rejects instead of leaving the UI believing the data is saved.
 *
 * Two object stores: `annotations` (JSON records, indexed by document) and
 * `audio` (one Blob per voice note, keyed by the annotation id). A comment and
 * its recording are written in one transaction so neither can exist alone.
 */
import { isAnnotation, type Annotation } from './annotations'

/** The recording behind a comment's voice note. */
export interface AudioRecord {
  /** The annotation id. */
  id: string
  blob: Blob
}

export interface AnnotationStore {
  list(documentId: string): Promise<Annotation[]>
  /**
   * Inserts or replaces an annotation. A comment with a voice note must be
   * written with its audio the first time; later updates (editing the body)
   * leave the audio untouched when `audio` is omitted.
   */
  put(annotation: Annotation, audio?: AudioRecord): Promise<void>
  /** The recording of a voice note, or null when none is stored. */
  getAudio(id: string): Promise<AudioRecord | null>
  /** Removes the annotation and its audio, if any. */
  delete(id: string): Promise<void>
  close(): void
}

const DB_VERSION = 2
const ANNOTATIONS = 'annotations'
const AUDIO = 'audio'
const BY_DOCUMENT = 'documentId'

export function openDatabase(
  dbName = 'voxnote',
  factory: IDBFactory = indexedDB,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(dbName, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      // v1: annotations. v2: audio. Both guards make the upgrade idempotent.
      if (!db.objectStoreNames.contains(ANNOTATIONS)) {
        const store = db.createObjectStore(ANNOTATIONS, { keyPath: 'id' })
        store.createIndex(BY_DOCUMENT, 'documentId', { unique: false })
      }
      if (!db.objectStoreNames.contains(AUDIO)) {
        db.createObjectStore(AUDIO, { keyPath: 'id' })
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
    return this.run([ANNOTATIONS], 'readonly', (tx) =>
      tx.objectStore(ANNOTATIONS).index(BY_DOCUMENT).getAll(documentId),
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

  put(annotation: Annotation, audio?: AudioRecord): Promise<void> {
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
    if (audio) {
      if (candidate.kind !== 'comment' || !candidate.voice) {
        return Promise.reject(
          new Error(
            `Annotation ${candidate.id} has no voice note for its audio`,
          ),
        )
      }
      if (audio.id !== candidate.id) {
        return Promise.reject(
          new Error(
            `Audio id ${audio.id} does not match annotation ${candidate.id}`,
          ),
        )
      }
      if (!(audio.blob instanceof Blob) || audio.blob.size === 0) {
        return Promise.reject(new Error('Refusing to store empty audio'))
      }
    }
    return this.run([ANNOTATIONS, AUDIO], 'readwrite', (tx) => {
      if (audio) tx.objectStore(AUDIO).put(audio)
      return tx.objectStore(ANNOTATIONS).put(annotation)
    }).then(() => undefined)
  }

  getAudio(id: string): Promise<AudioRecord | null> {
    return this.run([AUDIO], 'readonly', (tx) =>
      tx.objectStore(AUDIO).get(id),
    ).then((record: unknown) => {
      if (record === undefined) return null
      if (!isAudioRecord(record) || record.id !== id) {
        throw new Error(`Corrupt audio record in IndexedDB for ${id}`)
      }
      return record
    })
  }

  delete(id: string): Promise<void> {
    return this.run([ANNOTATIONS, AUDIO], 'readwrite', (tx) => {
      tx.objectStore(AUDIO).delete(id)
      return tx.objectStore(ANNOTATIONS).delete(id)
    }).then(() => undefined)
  }

  close(): void {
    this.db.close()
  }

  /**
   * Runs requests in one transaction; settles when it commits with the result
   * of the request `operation` returned. Any request error aborts the
   * transaction, so a multi-store write is all or nothing.
   */
  private run<T>(
    stores: string[],
    mode: IDBTransactionMode,
    operation: (tx: IDBTransaction) => IDBRequest<T>,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(stores, mode)
      const request = operation(transaction)
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

function isAudioRecord(value: unknown): value is AudioRecord {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  return typeof r.id === 'string' && r.blob instanceof Blob
}

function toError(error: DOMException | null, context: string): Error {
  return new Error(
    `IndexedDB ${context} failed: ${error?.message ?? 'unknown error'}`,
  )
}
