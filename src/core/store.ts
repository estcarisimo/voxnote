/**
 * Local-first persistence of annotations in IndexedDB. Records are validated
 * on the way out; a corrupt record is an error, not something to skip. Writes
 * resolve only once the transaction has committed, so a failed commit (quota,
 * eviction) rejects instead of leaving the UI believing the data is saved.
 *
 * Three object stores: `annotations` (JSON records, indexed by document),
 * `audio` (one Blob per voice note, keyed by the annotation id) and
 * `documentMeta` (one small record per annotated document: its file name and
 * when its notes were last written, so the landing can say which file to reopen).
 * A comment and its recording are written in one transaction so neither can
 * exist alone; every annotation write updates the document's meta record in
 * that same transaction.
 */
import {
  isAnnotation,
  isNote,
  migrateAnnotation,
  type Annotation,
} from './annotations'

/** The recording behind a comment's voice note. */
export interface AudioRecord {
  /** The annotation id. */
  id: string
  blob: Blob
}

/** How the user knows a document: the file name it was opened as. */
export interface DocumentLabel {
  name: string
  kind: 'pdf' | 'markdown'
}

/**
 * What the store remembers about an annotated document, beside its
 * annotations. `name` and `kind` are null for a document annotated before
 * this record existed, until it is opened again.
 */
export interface DocumentMeta {
  /** The document id (SHA-256 of the file's bytes). */
  id: string
  name: string | null
  kind: DocumentLabel['kind'] | null
  /** UTC, ISO 8601: the last time one of its annotations was written. */
  lastAnnotatedAt: string
}

/** A row of the recent-documents list. */
export interface DocumentSummary extends DocumentMeta {
  /** Annotations stored for it now. */
  count: number
}

export interface AnnotationStore {
  list(documentId: string): Promise<Annotation[]>
  /**
   * Inserts or replaces an annotation. A comment with a voice note must be
   * written with its audio the first time; later updates (editing the body)
   * leave the audio untouched when `audio` is omitted. The document's meta
   * record is updated in the same transaction; `document` names it (an
   * existing name is kept when omitted).
   */
  put(
    annotation: Annotation,
    audio?: AudioRecord,
    document?: DocumentLabel,
  ): Promise<void>
  /**
   * Writes several annotations of one document in one transaction, all or
   * none, without touching their audio. For imports.
   */
  putMany(
    annotations: readonly Annotation[],
    document?: DocumentLabel,
  ): Promise<void>
  /**
   * Records the name of a document that already has a meta record (one
   * annotated before names were kept). Never creates a record: a document
   * is listed only once something was annotated in it.
   */
  nameDocument(documentId: string, document: DocumentLabel): Promise<void>
  /**
   * Documents with at least one annotation, most recently annotated first.
   */
  listDocuments(): Promise<DocumentSummary[]>
  /** The recording of a voice note, or null when none is stored. */
  getAudio(id: string): Promise<AudioRecord | null>
  /** Removes the annotation and its audio, if any. */
  delete(id: string): Promise<void>
  close(): void
}

/**
 * v1 annotations, v2 audio, v3 documentMeta (resume a review, PR #30),
 * v4 documents, session and drafts (crash recovery, PR #31). Every store is
 * created behind its own guard, so any older database, including one built
 * by an unreleased branch that created the v4 stores at version 3, upgrades
 * to the same schema.
 */
export const DB_VERSION = 4
const ANNOTATIONS = 'annotations'
const AUDIO = 'audio'
const DOCUMENT_META = 'documentMeta'
const BY_DOCUMENT = 'documentId'
/** Crash recovery; see docs/design/crash-recovery.md and recoveryStore.ts. */
export const DOCUMENTS = 'documents'
export const SESSION = 'session'
export const DRAFTS = 'drafts'

export function openDatabase(
  dbName = 'voxnote',
  factory: IDBFactory = indexedDB,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(dbName, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      // v1: annotations. v2: audio. v3: documentMeta. v4: documents,
      // session, drafts. The guards make the upgrade idempotent.
      if (!db.objectStoreNames.contains(ANNOTATIONS)) {
        const store = db.createObjectStore(ANNOTATIONS, { keyPath: 'id' })
        store.createIndex(BY_DOCUMENT, 'documentId', { unique: false })
      }
      if (!db.objectStoreNames.contains(AUDIO)) {
        db.createObjectStore(AUDIO, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(DOCUMENT_META)) {
        const meta = db.createObjectStore(DOCUMENT_META, { keyPath: 'id' })
        // Documents annotated before v3 get a record without a name, dated
        // by their latest annotation, so they are listed from the start.
        backfillDocumentMeta(request.transaction!, meta)
      }
      if (!db.objectStoreNames.contains(DOCUMENTS)) {
        db.createObjectStore(DOCUMENTS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(SESSION)) {
        db.createObjectStore(SESSION, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(DRAFTS)) {
        db.createObjectStore(DRAFTS, { keyPath: 'documentId' })
      }
    }
    let settled = false
    request.onerror = () => {
      settled = true
      reject(toError(request.error, 'open'))
    }
    request.onblocked = () => {
      settled = true
      reject(new Error('IndexedDB open is blocked by another connection'))
    }
    request.onsuccess = () => {
      const db = request.result
      if (settled) {
        // Rejected as blocked, then the other connection went away: nobody
        // is waiting for this handle any more.
        db.close()
        return
      }
      settled = true
      // Let a future schema upgrade in another tab proceed.
      db.onversionchange = () => db.close()
      resolve(db)
    }
  })
}

function backfillDocumentMeta(tx: IDBTransaction, meta: IDBObjectStore) {
  const latest = new Map<string, string>()
  const cursor = tx.objectStore(ANNOTATIONS).openCursor()
  cursor.onsuccess = () => {
    const c = cursor.result
    if (c) {
      const r = c.value as Record<string, unknown>
      if (typeof r.documentId === 'string') {
        // A record without a usable time still lists its document; the
        // epoch sorts it last instead of hiding it.
        const at = typeof r.updatedAt === 'string' ? r.updatedAt : EPOCH
        const seen = latest.get(r.documentId)
        if (seen === undefined || at > seen) latest.set(r.documentId, at)
      }
      c.continue()
      return
    }
    for (const [id, lastAnnotatedAt] of latest) {
      const record: DocumentMeta = {
        id,
        name: null,
        kind: null,
        lastAnnotatedAt,
      }
      meta.put(record)
    }
  }
}

const EPOCH = new Date(0).toISOString()

export async function openAnnotationStore(
  dbName = 'voxnote',
  factory: IDBFactory = indexedDB,
  now: () => Date = () => new Date(),
): Promise<AnnotationStore> {
  return createAnnotationStore(await openDatabase(dbName, factory), now)
}

export function createAnnotationStore(
  db: IDBDatabase,
  now: () => Date = () => new Date(),
): AnnotationStore {
  return new IndexedDbAnnotationStore(db, now)
}

class IndexedDbAnnotationStore implements AnnotationStore {
  private readonly db: IDBDatabase
  private readonly now: () => Date

  constructor(db: IDBDatabase, now: () => Date) {
    this.db = db
    this.now = now
  }

  list(documentId: string): Promise<Annotation[]> {
    return this.run([ANNOTATIONS], 'readonly', (tx) =>
      tx.objectStore(ANNOTATIONS).index(BY_DOCUMENT).getAll(documentId),
    ).then((stored: unknown[]) => {
      // Older records are upgraded in memory; the next write stores them in
      // the current schema.
      const records = stored.map(migrateAnnotation)
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

  put(
    annotation: Annotation,
    audio?: AudioRecord,
    document?: DocumentLabel,
  ): Promise<void> {
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
      if (!isNote(candidate) || !candidate.voice) {
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
    if (document && !isDocumentLabel(document)) {
      return Promise.reject(
        new Error(`Invalid document label: ${JSON.stringify(document)}`),
      )
    }
    const at = this.now().toISOString()
    return this.run([ANNOTATIONS, AUDIO, DOCUMENT_META], 'readwrite', (tx) => {
      if (audio) tx.objectStore(AUDIO).put(audio)
      touchMeta(tx, candidate.documentId, document, at)
      return tx.objectStore(ANNOTATIONS).put(annotation)
    }).then(() => undefined)
  }

  putMany(
    annotations: readonly Annotation[],
    document?: DocumentLabel,
  ): Promise<void> {
    if (annotations.length === 0) return Promise.resolve()
    const documentId = annotations[0].documentId
    for (const annotation of annotations) {
      const candidate: unknown = annotation
      if (!isAnnotation(candidate)) {
        return Promise.reject(
          new Error(
            `Refusing to store an invalid annotation: ${JSON.stringify(candidate)}`,
          ),
        )
      }
      if (candidate.documentId !== documentId) {
        return Promise.reject(
          new Error(
            `Annotation ${candidate.id} belongs to document ${candidate.documentId}, not ${documentId}`,
          ),
        )
      }
    }
    if (document && !isDocumentLabel(document)) {
      return Promise.reject(
        new Error(`Invalid document label: ${JSON.stringify(document)}`),
      )
    }
    const at = this.now().toISOString()
    return this.run([ANNOTATIONS, DOCUMENT_META], 'readwrite', (tx) => {
      touchMeta(tx, documentId, document, at)
      const store = tx.objectStore(ANNOTATIONS)
      let last: IDBRequest<IDBValidKey> | undefined
      for (const annotation of annotations) last = store.put(annotation)
      return last!
    }).then(() => undefined)
  }

  nameDocument(documentId: string, document: DocumentLabel): Promise<void> {
    if (!isDocumentLabel(document)) {
      return Promise.reject(
        new Error(`Invalid document label: ${JSON.stringify(document)}`),
      )
    }
    return this.run([DOCUMENT_META], 'readwrite', (tx) => {
      const meta = tx.objectStore(DOCUMENT_META)
      const request = meta.get(documentId)
      // A listener, not onsuccess: run() sets its own handler on the
      // request this returns.
      request.addEventListener('success', () => {
        const existing: unknown = request.result
        if (existing === undefined) return
        if (!isDocumentMeta(existing)) {
          abortBecause(tx, corruptMeta(existing))
          return
        }
        if (
          existing.name === document.name &&
          existing.kind === document.kind
        ) {
          return
        }
        meta.put({ ...existing, name: document.name, kind: document.kind })
      })
      return request
    }).then(() => undefined)
  }

  listDocuments(): Promise<DocumentSummary[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([ANNOTATIONS, DOCUMENT_META], 'readonly')
      const summaries: DocumentSummary[] = []
      let failure: Error | null = null
      const metas = tx.objectStore(DOCUMENT_META).getAll()
      metas.onsuccess = () => {
        const index = tx.objectStore(ANNOTATIONS).index(BY_DOCUMENT)
        for (const record of metas.result as unknown[]) {
          if (!isDocumentMeta(record)) {
            failure = new Error(
              `Corrupt document record in IndexedDB: ${JSON.stringify(record)}`,
            )
            tx.abort()
            return
          }
          const count = index.count(record.id)
          count.onsuccess = () => {
            if (count.result > 0) {
              summaries.push({ ...record, count: count.result })
            }
          }
        }
      }
      tx.onabort = () => reject(failure ?? toError(tx.error, 'abort'))
      tx.oncomplete = () =>
        resolve(
          summaries.sort(
            (a, b) =>
              compareStrings(b.lastAnnotatedAt, a.lastAnnotatedAt) ||
              compareStrings(a.id, b.id),
          ),
        )
    })
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
    return runTransaction(this.db, stores, mode, operation)
  }
}

/** Why a transaction was aborted on purpose; tx.error stays null then. */
const abortReasons = new WeakMap<IDBTransaction, Error>()

function abortBecause(tx: IDBTransaction, reason: Error) {
  abortReasons.set(tx, reason)
  tx.abort()
}

function corruptMeta(record: unknown): Error {
  return new Error(
    `Corrupt document record in IndexedDB: ${JSON.stringify(record)}`,
  )
}

/**
 * Creates or refreshes the document's meta record inside a write: the time
 * always, the name and kind when the caller knows them.
 */
function touchMeta(
  tx: IDBTransaction,
  documentId: string,
  document: DocumentLabel | undefined,
  at: string,
) {
  const meta = tx.objectStore(DOCUMENT_META)
  // These requests fail only with the transaction (another request's error,
  // an abort), which run() reports from the transaction itself; letting
  // their AbortError bubble would mask that cause.
  const quiet = (r: IDBRequest) => {
    r.onerror = (event) => event.stopPropagation()
  }
  const request = meta.get(documentId)
  quiet(request)
  request.onsuccess = () => {
    const stored: unknown = request.result
    if (stored !== undefined && !isDocumentMeta(stored)) {
      // Abort the whole write rather than overwrite a record we cannot read.
      abortBecause(tx, corruptMeta(stored))
      return
    }
    const existing = stored as DocumentMeta | undefined
    const record: DocumentMeta = {
      id: documentId,
      name: document?.name ?? existing?.name ?? null,
      kind: document?.kind ?? existing?.kind ?? null,
      lastAnnotatedAt: at,
    }
    quiet(meta.put(record))
  }
}

function isDocumentLabel(value: unknown): value is DocumentLabel {
  if (typeof value !== 'object' || value === null) return false
  const d = value as Record<string, unknown>
  return (
    typeof d.name === 'string' &&
    d.name.length > 0 &&
    (d.kind === 'pdf' || d.kind === 'markdown')
  )
}

function isDocumentMeta(value: unknown): value is DocumentMeta {
  if (typeof value !== 'object' || value === null) return false
  const d = value as Record<string, unknown>
  return (
    typeof d.id === 'string' &&
    d.id.length > 0 &&
    (d.name === null || (typeof d.name === 'string' && d.name.length > 0)) &&
    (d.kind === null || d.kind === 'pdf' || d.kind === 'markdown') &&
    typeof d.lastAnnotatedAt === 'string'
  )
}

/** Code-unit order, so sorting never depends on the host's locale. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function isAudioRecord(value: unknown): value is AudioRecord {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  return typeof r.id === 'string' && r.blob instanceof Blob
}

/**
 * Runs requests in one transaction; settles when it commits with the result
 * of the request `operation` returned. Any request error aborts the
 * transaction, so a multi-store write is all or nothing. Shared with the
 * crash-recovery store.
 */
export function runTransaction<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  operation: (tx: IDBTransaction) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(stores, mode)
    let result: T | undefined
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      // An abort on purpose says why, whichever event reports it first.
      error = abortReasons.get(transaction) ?? error
      settled = true
      reject(error)
    }
    let request: IDBRequest<T>
    try {
      request = operation(transaction)
    } catch (err: unknown) {
      // A request that throws synchronously (DataError, DataCloneError)
      // leaves the earlier requests queued; without this the transaction
      // would commit them alone.
      transaction.abort()
      fail(
        new Error(
          `IndexedDB ${mode} failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      )
      return
    }
    request.onsuccess = () => {
      result = request.result
    }
    request.onerror = () => fail(toError(request.error, mode))
    transaction.onabort = () =>
      fail(abortReasons.get(transaction) ?? toError(transaction.error, 'abort'))
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
