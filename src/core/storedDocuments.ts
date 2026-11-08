/**
 * The seam between the recent-documents list and the document bytes kept in
 * this browser by crash recovery (the `documents` store, see
 * recoveryStore.ts and docs/design/crash-recovery.md). A document whose bytes
 * are kept reopens in one tap; any other asks the user for its file. The
 * file it returns is hashed again on open, so stored bytes that no longer
 * match their id cannot show another document's notes.
 */
import type { RecoveryStore } from './recoveryStore'

export interface StoredDocuments {
  /** Ids of the documents whose bytes are stored in this browser. */
  ids(): Promise<ReadonlySet<string>>
  /** The stored file, or null when its bytes are not kept. */
  get(id: string): Promise<File | null>
}

/** No document bytes are available (the store is not open): ask for files. */
export const NO_STORED_DOCUMENTS: StoredDocuments = {
  ids: async () => new Set<string>(),
  get: async () => null,
}

/** The documents kept by crash recovery, as files to reopen. */
export function storedDocumentsFrom(store: RecoveryStore): StoredDocuments {
  return {
    async ids() {
      return new Set((await store.listDocuments()).map((d) => d.id))
    },
    async get(id) {
      const stored = await store.getDocument(id)
      if (!stored) return null
      return new File([stored.blob], stored.name, { type: stored.mimeType })
    },
  }
}
