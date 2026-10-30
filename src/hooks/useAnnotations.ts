import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createComment,
  createHighlight,
  createSuggestion,
  isNote,
  withBody,
  withTranscript,
  withVisibility,
  type Anchor,
  type Annotation,
  type CleanUp,
  type Note,
  type TextAnchor,
  type Transcript,
  type Visibility,
  type VoiceNote,
} from '../core/annotations'
import { withCleanUp, type CleanUpProposal } from '../core/cleanUp'
import { openAnnotationStore, type AnnotationStore } from '../core/store'

export type NewNote =
  | {
      kind: 'comment'
      anchor: Anchor
      body: string
      voice?: VoiceNote
      /** Required when `voice` is set: the recording itself. */
      audio?: Blob
      cleanUp?: CleanUp
    }
  | {
      kind: 'suggestion'
      anchor: TextAnchor
      /** The replacement text; may be empty with a voice note. */
      body: string
      voice?: VoiceNote
      audio?: Blob
      cleanUp?: CleanUp
    }

interface AnnotationsState {
  annotations: Annotation[]
  /** False until the store for the current document has loaded. */
  ready: boolean
  error: string | null
  addHighlight: (anchor: Anchor) => Promise<Annotation>
  addNote: (input: NewNote) => Promise<Note>
  updateBody: (id: string, body: string) => Promise<Note>
  /** Marks an annotation private or for the author. */
  updateVisibility: (id: string, visibility: Visibility) => Promise<Annotation>
  /** Attaches a transcript to a dictated note; fills an empty body. */
  setTranscript: (id: string, transcript: Transcript) => Promise<Note>
  /** Puts an accepted clean-up in the body; the raw transcript stays. */
  applyCleanUp: (id: string, proposal: CleanUpProposal) => Promise<Note>
  /** The recording behind a voice comment, or null when it has none. */
  getAudio: (id: string) => Promise<Blob | null>
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
  // The list as of the last write, ahead of the render that shows it: a
  // transcript arriving right after a save must find the saved note even
  // when the caller still holds the callbacks of the previous render.
  const latest = useRef<Loaded | null>(null)

  useEffect(() => {
    if (!documentId) return
    let cancelled = false
    let opened: AnnotationStore | null = null

    openAnnotationStore()
      .then(async (store) => {
        if (cancelled) {
          // The effect was cleaned up while the open was in flight (document
          // switch, StrictMode double mount): nobody else will close it.
          store.close()
          return
        }
        opened = store
        const annotations = await store.list(documentId)
        if (cancelled) return
        latest.current = { documentId, store, annotations }
        setLoaded(latest.current)
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

  /** Applies a change to this document's list, if it is still the current one. */
  const apply = useCallback(
    (documentId: string, change: (list: Annotation[]) => Annotation[]) => {
      const state = latest.current
      if (!state || state.documentId !== documentId) return
      latest.current = { ...state, annotations: change(state.annotations) }
      setLoaded(latest.current)
    },
    [],
  )

  const addHighlight = useCallback(
    async (anchor: Anchor) => {
      if (!current) throw new Error('Annotation store is not ready')
      const annotation = createHighlight({
        documentId: current.documentId,
        anchor,
      })
      await current.store.put(annotation)
      apply(current.documentId, (list) => [...list, annotation])
      return annotation
    },
    [current, apply],
  )

  const addNote = useCallback(
    async (input: NewNote) => {
      if (!current) throw new Error('Annotation store is not ready')
      if (input.voice && !input.audio) {
        throw new Error('A voice note needs its recording')
      }
      const note: Note =
        input.kind === 'suggestion'
          ? createSuggestion({
              documentId: current.documentId,
              anchor: input.anchor,
              body: input.body,
              voice: input.voice,
              cleanUp: input.cleanUp,
            })
          : createComment({
              documentId: current.documentId,
              anchor: input.anchor,
              body: input.body,
              voice: input.voice,
              cleanUp: input.cleanUp,
            })
      await current.store.put(
        note,
        input.audio ? { id: note.id, blob: input.audio } : undefined,
      )
      apply(current.documentId, (list) => [...list, note])
      return note
    },
    [current, apply],
  )

  const updateBody = useCallback(
    async (id: string, body: string) => {
      if (!current) throw new Error('Annotation store is not ready')
      const existing = current.annotations.find((a) => a.id === id)
      if (!existing || !isNote(existing)) {
        throw new Error(`No comment or suggestion with id ${id}`)
      }
      const updated = withBody(existing, body)
      await current.store.put(updated)
      apply(current.documentId, (list) =>
        list.map((a) => (a.id === id ? updated : a)),
      )
      return updated
    },
    [current, apply],
  )

  const updateVisibility = useCallback(
    async (id: string, visibility: Visibility) => {
      if (!current) throw new Error('Annotation store is not ready')
      const existing = current.annotations.find((a) => a.id === id)
      if (!existing) throw new Error(`No annotation with id ${id}`)
      const updated = withVisibility(existing, visibility)
      await current.store.put(updated)
      apply(current.documentId, (list) =>
        list.map((a) => (a.id === id ? updated : a)),
      )
      return updated
    },
    [current, apply],
  )

  const setTranscript = useCallback(
    async (id: string, transcript: Transcript) => {
      if (!current) throw new Error('Annotation store is not ready')
      // Read the latest write, not this render's list: see `latest`.
      const state =
        latest.current?.documentId === current.documentId
          ? latest.current
          : current
      const existing = state.annotations.find((a) => a.id === id)
      if (!existing || !isNote(existing)) {
        throw new Error(`No comment or suggestion with id ${id}`)
      }
      const updated = withTranscript(existing, transcript)
      await state.store.put(updated)
      apply(state.documentId, (list) =>
        list.map((a) => (a.id === id ? updated : a)),
      )
      return updated
    },
    [current, apply],
  )

  const applyCleanUp = useCallback(
    async (id: string, proposal: CleanUpProposal) => {
      if (!current) throw new Error('Annotation store is not ready')
      const existing = current.annotations.find((a) => a.id === id)
      if (!existing || !isNote(existing)) {
        throw new Error(`No comment or suggestion with id ${id}`)
      }
      const updated = withCleanUp(existing, proposal)
      await current.store.put(updated)
      apply(current.documentId, (list) =>
        list.map((a) => (a.id === id ? updated : a)),
      )
      return updated
    },
    [current, apply],
  )

  const getAudio = useCallback(
    async (id: string) => {
      if (!current) throw new Error('Annotation store is not ready')
      const record = await current.store.getAudio(id)
      return record?.blob ?? null
    },
    [current],
  )

  const remove = useCallback(
    async (id: string) => {
      if (!current) throw new Error('Annotation store is not ready')
      await current.store.delete(id)
      apply(current.documentId, (list) => list.filter((a) => a.id !== id))
    },
    [current, apply],
  )

  return {
    annotations: current?.annotations ?? NONE,
    ready: current !== null,
    error: failed && failed.documentId === documentId ? failed.message : null,
    addHighlight,
    addNote,
    updateBody,
    updateVisibility,
    setTranscript,
    applyCleanUp,
    getAudio,
    remove,
  }
}
