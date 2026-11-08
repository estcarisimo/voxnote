import { useCallback, useEffect, useRef, useState } from 'react'
import {
  draftHasContent,
  type Draft,
  type RecoveryStore,
} from '../core/recoveryStore'

/** How long typing must pause before the draft is written. */
export const DRAFT_DEBOUNCE_MS = 400

/** The parts of a draft that change while the composer is open. */
export type DraftPatch = Partial<
  Pick<Draft, 'body' | 'audio' | 'transcript' | 'cleanUp'>
>

export interface DraftKeeper {
  /** False until the stored draft for the document has been read. */
  ready: boolean
  /** The draft found when the document opened, if any. */
  restored: Draft | null
  /** A failed read or write; shown to the user, never swallowed. */
  error: string | null
  /** A composer opened: starts a new draft for it. */
  begin(base: Pick<Draft, 'mode' | 'anchor' | 'placement' | 'body'>): void
  /**
   * Changes the open draft. A key present with `undefined` removes that
   * field (a discarded recording takes its transcript with it).
   */
  update(patch: DraftPatch): void
  /** Saved, cancelled or discarded: the draft is deleted. */
  remove(): void
}

/** Where drafts are kept; `error` set when the store could not be opened. */
export interface RecoverySource {
  store: RecoveryStore | null
  error: string | null
}

interface Loaded {
  documentId: string
  draft: Draft | null
}

/**
 * Keeps the open composer's draft for one document in IndexedDB: written
 * {@link DRAFT_DEBOUNCE_MS} after the last change, at once when the page is
 * hidden or unloaded, and when the document closes. Writes run one after the
 * other, so a delete is never overtaken by an older write.
 */
export function useDraft(
  documentId: string | null,
  source: RecoverySource,
): DraftKeeper {
  const { store } = source
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = useRef<Draft | null>(null)
  const dirty = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const queue = useRef<Promise<void>>(Promise.resolve())

  const enqueue = useCallback((write: () => Promise<void>) => {
    queue.current = queue.current.then(write).catch((err: unknown) => {
      setError(
        `Could not keep the draft on this device: ${err instanceof Error ? err.message : String(err)}`,
      )
    })
  }, [])

  /** Writes the pending change now, if there is one. */
  const flush = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = undefined
    const target = dirty.current
    if (!store || target === null) return
    dirty.current = null
    const snapshot = current.current
    enqueue(() =>
      snapshot?.documentId === target && draftHasContent(snapshot)
        ? store.putDraft(snapshot)
        : store.deleteDraft(target),
    )
  }, [store, enqueue])

  // Read the draft when a document opens; write what is pending when it
  // closes. Closing keeps the draft: only Save, Cancel or Discard drop it.
  useEffect(() => {
    current.current = null
    if (!store || !documentId) return
    let live = true
    store.getDraft(documentId).then(
      (draft) => {
        if (!live) return
        current.current = draft
        setLoaded({ documentId, draft })
      },
      (err: unknown) => {
        if (!live) return
        setError(
          `Could not read the saved draft: ${err instanceof Error ? err.message : String(err)}`,
        )
        setLoaded({ documentId, draft: null })
      },
    )
    return () => {
      live = false
      flush()
      current.current = null
    }
  }, [store, documentId, flush])

  // A tab killed in the background gets no unload event on iOS: hidden is
  // the last moment to write.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [flush])

  const schedule = useCallback(() => {
    if (!current.current) return
    dirty.current = current.current.documentId
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, DRAFT_DEBOUNCE_MS)
  }, [flush])

  const begin = useCallback<DraftKeeper['begin']>(
    (base) => {
      if (!documentId) return
      current.current = {
        documentId,
        ...base,
        updatedAt: new Date().toISOString(),
      }
      schedule()
    },
    [documentId, schedule],
  )

  const update = useCallback<DraftKeeper['update']>(
    (patch) => {
      const draft = current.current
      if (!draft) return
      const next: Record<string, unknown> = { ...draft }
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete next[key]
        else next[key] = value
      }
      next.updatedAt = new Date().toISOString()
      current.current = next as unknown as Draft
      schedule()
    },
    [schedule],
  )

  const remove = useCallback(() => {
    const draft = current.current
    clearTimeout(timer.current)
    timer.current = undefined
    dirty.current = null
    current.current = null
    const target = draft?.documentId ?? documentId
    if (!store || !target) return
    enqueue(() => store.deleteDraft(target))
  }, [store, documentId, enqueue])

  const ready =
    source.error !== null ||
    documentId === null ||
    (loaded !== null && loaded.documentId === documentId)
  return {
    ready,
    restored: loaded && loaded.documentId === documentId ? loaded.draft : null,
    error,
    begin,
    update,
    remove,
  }
}
