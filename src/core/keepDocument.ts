/**
 * What happens to a freshly opened document so a crash can be resumed: its
 * bytes are kept, the session names it, and only then is the browser asked
 * for persistent storage. That request can wait on a permission prompt
 * (Firefox asks the user), so nothing waits on it: the session is written
 * first, and the outcome is reported on its own.
 */
import type { RecoveryStore } from './recoveryStore'
import type { StorageStatus } from './storagePersistence'

export interface KeepDocumentInput {
  id: string
  name: string
  mimeType: string
  bytes: Uint8Array
  /** The PDF page to resume at; null for Markdown. */
  page: number | null
}

export interface KeepDocumentEffects {
  store: RecoveryStore
  /** False once the document was closed or replaced while writing. */
  isStillOpen: () => boolean
  /** The persistent-storage request; not awaited. */
  ensurePersistent: () => Promise<StorageStatus>
  /** The bytes are kept: the session may now name this document. */
  onKept: (id: string) => void
  onError: (message: string) => void
  now?: () => Date
}

export const NO_PERSIST_API =
  'This browser offers no way to request persistent storage (navigator.storage.persist is missing), so it may delete your annotations, recordings and kept documents. Safari does so after seven days of use without opening VoxNote, unless VoxNote is added to the Home Screen. Export your notes to keep a copy.'

/**
 * Keeps the document and records the session. Resolves once both writes
 * are done (or reported); the persistence request may still be pending.
 */
export async function keepOpenedDocument(
  input: KeepDocumentInput,
  effects: KeepDocumentEffects,
): Promise<void> {
  const { store, onError } = effects
  const now = effects.now ?? (() => new Date())
  const blob = new Blob([input.bytes as BlobPart], { type: input.mimeType })
  try {
    await store.putDocument({
      id: input.id,
      name: input.name,
      mimeType: input.mimeType,
      blob,
      size: blob.size,
      openedAt: now().toISOString(),
    })
  } catch (err: unknown) {
    let message = `"${input.name}" is open, but a copy could not be kept on this device (${messageOf(err)}). If this tab crashes you will need to open the file again; your annotations are saved separately.`
    // Resume must not offer the previous document instead.
    try {
      await store.clearSession()
    } catch (clearErr: unknown) {
      message += ` The previous session could not be cleared either (${messageOf(clearErr)}), so Resume may offer the document opened before this one.`
    }
    onError(message)
    return
  }
  // Closed while the bytes were written: Close cleared the session, and a
  // late write must not put it back.
  if (!effects.isStillOpen()) return
  effects.onKept(input.id)
  try {
    await store.putSession({
      documentId: input.id,
      page: input.page,
      updatedAt: now().toISOString(),
    })
  } catch (err: unknown) {
    onError(`Could not record the open document: ${messageOf(err)}`)
  }
  // The first write of a visit asks the browser not to evict what it holds.
  effects.ensurePersistent().then(
    (outcome) => {
      if (outcome.persistence === 'unavailable') onError(NO_PERSIST_API)
    },
    (err: unknown) =>
      onError(`Could not request persistent storage: ${messageOf(err)}`),
  )
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
