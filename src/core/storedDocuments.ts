/**
 * The seam between the recent-documents list and the document bytes kept in
 * this browser. Today VoxNote keeps no document bytes, so the list asks the
 * user for the file. The crash-recovery work adds a `documents` object store
 * to the same database, one record per opened document:
 *
 *   { id: string (SHA-256, the key), name: string, type: string (MIME),
 *     blob: Blob, openedAt: string (UTC, ISO 8601) }
 *
 * Once it lands, an implementation of StoredDocuments over that store
 * replaces NO_STORED_DOCUMENTS in App.tsx; nothing else changes. The file it
 * returns is hashed again on open, so stored bytes that no longer match their
 * id cannot show another document's notes.
 */
export interface StoredDocuments {
  /** Ids of the documents whose bytes are stored in this browser. */
  ids(): Promise<ReadonlySet<string>>
  /** The stored file, or null when its bytes are not kept. */
  get(id: string): Promise<File | null>
}

/** No document bytes are kept: every resume asks for the file. */
export const NO_STORED_DOCUMENTS: StoredDocuments = {
  ids: async () => new Set<string>(),
  get: async () => null,
}
