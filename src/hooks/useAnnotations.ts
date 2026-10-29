import { useCallback, useEffect, useState } from 'react'
import {
  createHighlight,
  type Anchor,
  type Annotation,
} from '../core/annotations'
import { openAnnotationStore, type AnnotationStore } from '../core/store'

interface AnnotationsState {
  annotations: Annotation[]
  /** False until the store for the current document has loaded. */
  ready: boolean
  error: string | null
  addHighlight: (anchor: Anchor) => Promise<Annotation>
  remove: (id: string) => Promise<void>
}

interface Loaded {
  documentId: string
  store: AnnotationStore
  annotations: Annotation[]
}

interface Failed {
  documentId: string
  message: string
}

const NONE: Annotation[] = []

/**
 * Local-first annotations for one document, persisted in IndexedDB. Writes go
 * to the store first and to React state only once they succeeded. State is
 * tagged with the document id, so switching documents never shows stale data.
 */
export function useAnnotations(documentId: string | null): AnnotationsState {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState<Failed | null>(null)

  useEffect(() => {
    if (!documentId) return
    let cancelled = false
    let opened: AnnotationStore | null = null

    openAnnotationStore()
      .then(async (store) => {
        opened = store
        const annotations = await store.list(documentId)
        if (cancelled) return
        setLoaded({ documentId, store, annotations })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setFailed({
          documentId,
          message: err instanceof Error ? err.message : String(err),
        })
      })

    return () => {
      cancelled = true
      opened?.close()
    }
  }, [documentId])

  const current = loaded && loaded.documentId === documentId ? loaded : null

  const addHighlight = useCallback(
    async (anchor: Anchor) => {
      if (!current) throw new Error('Annotation store is not ready')
      const annotation = createHighlight({
        documentId: current.documentId,
        anchor,
      })
      await current.store.put(annotation)
      setLoaded((state) =>
        state && state.documentId === current.documentId
          ? { ...state, annotations: [...state.annotations, annotation] }
          : state,
      )
      return annotation
    },
    [current],
  )

  const remove = useCallback(
    async (id: string) => {
      if (!current) throw new Error('Annotation store is not ready')
      await current.store.delete(id)
      setLoaded((state) =>
        state && state.documentId === current.documentId
          ? {
              ...state,
              annotations: state.annotations.filter((a) => a.id !== id),
            }
          : state,
      )
    },
    [current],
  )

  return {
    annotations: current?.annotations ?? NONE,
    ready: current !== null,
    error: failed && failed.documentId === documentId ? failed.message : null,
    addHighlight,
    remove,
  }
}
