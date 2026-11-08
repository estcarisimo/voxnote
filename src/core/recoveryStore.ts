/**
 * Crash recovery records in IndexedDB, next to the annotations: the bytes of
 * each opened document, the session (which document was open, and where),
 * and the draft of an unsaved comment or suggestion. The schema is described
 * in docs/design/crash-recovery.md; `openDatabase` creates the stores.
 *
 * Every record is validated on the way in and on the way out. A corrupt
 * record is an error, never something to skip, and every write resolves only
 * after its transaction commits, so a quota failure reaches the caller.
 */
import {
  isAnchor,
  isCleanUp,
  isQuoteAnchor,
  isTranscript,
  type Anchor,
  type Transcript,
} from './annotations'
import type { CleanUpProposal } from './cleanUp'
import {
  DOCUMENTS,
  DRAFTS,
  SESSION,
  openDatabase,
  runTransaction,
} from './store'

/** A document kept on this device so it can be reopened without its file. */
export interface StoredDocument {
  /** SHA-256 of the bytes, hex: the same id the annotations use. */
  id: string
  /** The file name it was opened under, most recent first. */
  name: string
  mimeType: string
  blob: Blob
  /** Bytes. */
  size: number
  /** When it was last opened, UTC ISO 8601. */
  openedAt: string
}

/** A stored document without its bytes, for lists. */
export type StoredDocumentSummary = Omit<StoredDocument, 'blob'>

/** The document open when the page last went away. */
export interface SessionRecord {
  documentId: string
  /** The PDF page in view; null for a Markdown document. */
  page: number | null
  /** UTC ISO 8601. */
  updatedAt: string
}

/** typed: a comment; voice: a dictated comment; suggest: a replacement. */
export type DraftMode = 'typed' | 'voice' | 'suggest'

/** Where the composer floats, in the viewer's scroll coordinates. */
export interface DraftPlacement {
  left: number
  top: number
  bottom: number
}

/** A recording that belongs to a draft. */
export interface DraftAudio {
  blob: Blob
  mimeType: string
  durationMs: number
  /** UTC ISO 8601, when recording started. */
  recordedAt: string
  /** False while recording: the blob holds the chunks written so far. */
  complete: boolean
}

/** An unsaved comment or suggestion, as the composer last showed it. */
export interface Draft {
  documentId: string
  mode: DraftMode
  anchor: Anchor
  placement: DraftPlacement
  body: string
  audio?: DraftAudio
  /** The raw transcript of `audio`, when one arrived before the crash. */
  transcript?: Transcript
  /** An accepted polish of that transcript, kept with its provenance. */
  cleanUp?: CleanUpProposal
  /** UTC ISO 8601. */
  updatedAt: string
}

export interface RecoveryStore {
  /**
   * Stores the bytes of an opened document. When the id is already stored,
   * only its name and `openedAt` change.
   */
  putDocument(document: StoredDocument): Promise<void>
  getDocument(id: string): Promise<StoredDocument | null>
  /** Metadata of every stored document, most recently opened first. */
  listDocuments(): Promise<StoredDocumentSummary[]>
  /** Forgets the bytes; annotations and drafts for that id stay. */
  deleteDocument(id: string): Promise<void>
  getSession(): Promise<SessionRecord | null>
  putSession(session: SessionRecord): Promise<void>
  clearSession(): Promise<void>
  getDraft(documentId: string): Promise<Draft | null>
  putDraft(draft: Draft): Promise<void>
  deleteDraft(documentId: string): Promise<void>
  close(): void
}

const SESSION_KEY = 'current'

export async function openRecoveryStore(
  dbName = 'voxnote',
  factory: IDBFactory = indexedDB,
): Promise<RecoveryStore> {
  return createRecoveryStore(await openDatabase(dbName, factory))
}

export function createRecoveryStore(db: IDBDatabase): RecoveryStore {
  const run = <T>(
    stores: string[],
    mode: IDBTransactionMode,
    operation: (tx: IDBTransaction) => IDBRequest<T>,
  ) => runTransaction(db, stores, mode, operation)

  return {
    putDocument(document) {
      if (!isStoredDocument(document)) {
        return Promise.reject(
          new Error(
            `Refusing to store an invalid document: ${describe(document)}`,
          ),
        )
      }
      return run([DOCUMENTS], 'readwrite', (tx) => {
        const documents = tx.objectStore(DOCUMENTS)
        const existing = documents.get(document.id)
        // runTransaction owns onsuccess; listen alongside it.
        existing.addEventListener('success', () => {
          const current: unknown = existing.result
          // The same bytes again: refresh the label, keep the stored Blob.
          documents.put(
            isStoredDocument(current)
              ? { ...current, name: document.name, openedAt: document.openedAt }
              : document,
          )
        })
        return existing
      }).then(() => undefined)
    },

    getDocument(id) {
      return run([DOCUMENTS], 'readonly', (tx) =>
        tx.objectStore(DOCUMENTS).get(id),
      ).then((record: unknown) => {
        if (record === undefined) return null
        if (!isStoredDocument(record) || record.id !== id) {
          throw new Error(`Corrupt stored document in IndexedDB for ${id}`)
        }
        return record
      })
    },

    listDocuments() {
      return run([DOCUMENTS], 'readonly', (tx) =>
        tx.objectStore(DOCUMENTS).getAll(),
      ).then((records: unknown[]) =>
        records
          .map((record) => {
            if (!isStoredDocument(record)) {
              throw new Error(
                `Corrupt stored document in IndexedDB: ${describe(record)}`,
              )
            }
            const { blob: _blob, ...summary } = record
            return summary
          })
          .sort((a, b) => b.openedAt.localeCompare(a.openedAt)),
      )
    },

    deleteDocument(id) {
      return run([DOCUMENTS], 'readwrite', (tx) =>
        tx.objectStore(DOCUMENTS).delete(id),
      ).then(() => undefined)
    },

    getSession() {
      return run([SESSION], 'readonly', (tx) =>
        tx.objectStore(SESSION).get(SESSION_KEY),
      ).then((record: unknown) => {
        if (record === undefined) return null
        const { key, ...session } = record as Record<string, unknown>
        if (key !== SESSION_KEY || !isSessionRecord(session)) {
          throw new Error(
            `Corrupt session record in IndexedDB: ${describe(record)}`,
          )
        }
        return session
      })
    },

    putSession(session) {
      if (!isSessionRecord(session)) {
        return Promise.reject(
          new Error(
            `Refusing to store an invalid session: ${describe(session)}`,
          ),
        )
      }
      return run([SESSION], 'readwrite', (tx) =>
        tx.objectStore(SESSION).put({ key: SESSION_KEY, ...session }),
      ).then(() => undefined)
    },

    clearSession() {
      return run([SESSION], 'readwrite', (tx) =>
        tx.objectStore(SESSION).delete(SESSION_KEY),
      ).then(() => undefined)
    },

    getDraft(documentId) {
      return run([DRAFTS], 'readonly', (tx) =>
        tx.objectStore(DRAFTS).get(documentId),
      ).then((record: unknown) => {
        if (record === undefined) return null
        if (!isDraft(record) || record.documentId !== documentId) {
          throw new Error(
            `Corrupt draft in IndexedDB for ${documentId}: ${describe(record)}`,
          )
        }
        return record
      })
    },

    putDraft(draft) {
      if (!isDraft(draft)) {
        return Promise.reject(
          new Error(`Refusing to store an invalid draft: ${describe(draft)}`),
        )
      }
      return run([DRAFTS], 'readwrite', (tx) =>
        tx.objectStore(DRAFTS).put(draft),
      ).then(() => undefined)
    },

    deleteDraft(documentId) {
      return run([DRAFTS], 'readwrite', (tx) =>
        tx.objectStore(DRAFTS).delete(documentId),
      ).then(() => undefined)
    },

    close() {
      db.close()
    },
  }
}

const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

function isUtcTimestamp(value: unknown): value is string {
  return typeof value === 'string' && UTC_ISO.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isStoredDocument(value: unknown): value is StoredDocument {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    /^[0-9a-f]{64}$/.test(value.id) &&
    typeof value.name === 'string' &&
    value.name !== '' &&
    typeof value.mimeType === 'string' &&
    value.blob instanceof Blob &&
    typeof value.size === 'number' &&
    value.size === value.blob.size &&
    value.size > 0 &&
    isUtcTimestamp(value.openedAt)
  )
}

export function isSessionRecord(value: unknown): value is SessionRecord {
  if (!isRecord(value)) return false
  return (
    typeof value.documentId === 'string' &&
    value.documentId !== '' &&
    (value.page === null ||
      (Number.isInteger(value.page) && (value.page as number) >= 1)) &&
    isUtcTimestamp(value.updatedAt)
  )
}

function isPlacement(value: unknown): value is DraftPlacement {
  return (
    isRecord(value) &&
    Number.isFinite(value.left) &&
    Number.isFinite(value.top) &&
    Number.isFinite(value.bottom)
  )
}

function isDraftAudio(value: unknown): value is DraftAudio {
  return (
    isRecord(value) &&
    value.blob instanceof Blob &&
    value.blob.size > 0 &&
    typeof value.mimeType === 'string' &&
    typeof value.durationMs === 'number' &&
    value.durationMs >= 0 &&
    isUtcTimestamp(value.recordedAt) &&
    typeof value.complete === 'boolean'
  )
}

function isCleanUpProposal(value: unknown): value is CleanUpProposal {
  return (
    isRecord(value) &&
    typeof value.text === 'string' &&
    isCleanUp(value.cleanUp)
  )
}

export function isDraft(value: unknown): value is Draft {
  if (!isRecord(value)) return false
  const { mode, anchor } = value
  if (mode !== 'typed' && mode !== 'voice' && mode !== 'suggest') return false
  if (!isAnchor(anchor)) return false
  if (mode === 'suggest' && !isQuoteAnchor(anchor)) return false
  // Only a recording can carry a transcript, and only a transcript a polish.
  if (value.transcript !== undefined && value.audio === undefined) return false
  if (value.cleanUp !== undefined && value.transcript === undefined) {
    return false
  }
  return (
    typeof value.documentId === 'string' &&
    value.documentId !== '' &&
    isPlacement(value.placement) &&
    typeof value.body === 'string' &&
    (value.audio === undefined ||
      (mode !== 'typed' && isDraftAudio(value.audio))) &&
    (value.transcript === undefined || isTranscript(value.transcript)) &&
    (value.cleanUp === undefined || isCleanUpProposal(value.cleanUp)) &&
    isUtcTimestamp(value.updatedAt)
  )
}

/** A record for an error message, without dumping a Blob's bytes. */
function describe(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, v: unknown) =>
      v instanceof Blob ? `[Blob ${v.size} bytes]` : v,
    )
  } catch {
    return String(value)
  }
}

/**
 * Whether a draft holds anything worth restoring: typed text (for a
 * suggestion, text that differs from the original) or a recording. An empty
 * composer is not kept, so a crash right after opening one restores nothing.
 */
export function draftHasContent(draft: Draft): boolean {
  if (draft.audio) return true
  const body = draft.body.trim()
  if (body === '') return false
  if (draft.mode === 'suggest' && draft.anchor.type !== 'region') {
    return body !== draft.anchor.quote.trim()
  }
  return true
}
