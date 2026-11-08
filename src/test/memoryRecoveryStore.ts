import type {
  Draft,
  RecoveryStore,
  SessionRecord,
  StoredDocument,
} from '../core/recoveryStore'

/**
 * An in-memory RecoveryStore for component and hook tests, where
 * fake-indexeddb cannot clone jsdom Blobs. `fail` makes writes reject.
 */
export function memoryRecoveryStore(): RecoveryStore & {
  drafts: Map<string, Draft>
  documents: Map<string, StoredDocument>
  session: SessionRecord | null
  fail: Error | null
} {
  const state = {
    drafts: new Map<string, Draft>(),
    documents: new Map<string, StoredDocument>(),
    session: null as SessionRecord | null,
    fail: null as Error | null,
  }
  const write = async (apply: () => void) => {
    if (state.fail) throw state.fail
    apply()
  }
  return Object.assign(state, {
    putDocument: (d: StoredDocument) =>
      write(() => state.documents.set(d.id, d)),
    getDocument: async (id: string) => state.documents.get(id) ?? null,
    listDocuments: async () =>
      [...state.documents.values()].map(({ blob: _blob, ...rest }) => rest),
    deleteDocument: (id: string) => write(() => state.documents.delete(id)),
    getSession: async () => state.session,
    putSession: (s: SessionRecord) => write(() => (state.session = s)),
    clearSession: () => write(() => (state.session = null)),
    getDraft: async (id: string) => state.drafts.get(id) ?? null,
    putDraft: (d: Draft) => write(() => state.drafts.set(d.documentId, d)),
    deleteDraft: (id: string) => write(() => state.drafts.delete(id)),
    close: () => {},
  })
}
