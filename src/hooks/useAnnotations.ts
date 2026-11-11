import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createComment,
  createHighlight,
  createSuggestion,
  isNote,
  withBody,
  withColor,
  withTranscript,
  withVisibility,
  type Anchor,
  type Annotation,
  type Answer,
  type Comment,
  type CleanUp,
  type Highlight,
  type Note,
  type QuoteAnchor,
  type Transcript,
  type Visibility,
  type VoiceNote,
} from '../core/annotations'
import { withAnswer, withoutAnswer } from '../core/ask'
import { withCleanUp, type CleanUpProposal } from '../core/cleanUp'
import type { HighlightColor } from '../core/palette'
import {
  openAnnotationStore,
  type AnnotationStore,
  type DocumentLabel,
} from '../core/store'

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
      anchor: QuoteAnchor
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
  /** Omitting the color gives the palette's default. */
  addHighlight: (anchor: Anchor, color?: HighlightColor) => Promise<Highlight>
  addNote: (input: NewNote) => Promise<Note>
  updateBody: (id: string, body: string) => Promise<Note>
  /** Marks an annotation private or for the author. */
  updateVisibility: (id: string, visibility: Visibility) => Promise<Annotation>
  /** Recolors a highlight from the palette. */
  updateColor: (id: string, color: HighlightColor) => Promise<Highlight>
  /** Attaches a transcript to a dictated note; fills an empty body. */
  setTranscript: (id: string, transcript: Transcript) => Promise<Note>
  /** Puts an accepted clean-up in the body; the raw transcript stays. */
  applyCleanUp: (id: string, proposal: CleanUpProposal) => Promise<Note>
  /** Keeps a model's answer beside a comment; the body stays as it is. */
  addAnswer: (id: string, answer: Answer) => Promise<Comment>
  /** Deletes one answer from a comment. */
  removeAnswer: (id: string, answerId: string) => Promise<Comment>
  /** The recording behind a voice comment, or null when it has none. */
  getAudio: (id: string) => Promise<Blob | null>
  remove: (id: string) => Promise<void>
  /**
   * Runs a write against this document's store (an import), one at a time
   * with the other writes, then reloads the list from the store.
   */
  writeAndReload: <T>(
    write: (store: AnnotationStore) => Promise<T>,
  ) => Promise<T>
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
export function useAnnotations(
  documentId: string | null,
  /** The open file's name and kind, recorded beside every write. */
  label?: DocumentLabel,
): AnnotationsState {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  // Read at write time: a label change alone must not reopen the store.
  const labelRef = useRef(label)
  useEffect(() => {
    labelRef.current = label
  })
  const [failed, setFailed] = useState<Failed | null>(null)
  // The list as of the last write, ahead of the render that shows it: a
  // transcript arriving right after a save must find the saved note even
  // when the caller still holds the callbacks of the previous render.
  // Every write reads it, through `serialize`.
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
        // A document annotated before names were kept gets its name now,
        // so the recent list can say which file it is.
        const name = labelRef.current
        if (annotations.length > 0 && name) {
          await store.nameDocument(documentId, name)
          if (cancelled) return
        }
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

  // Writes run one at a time, each on the latest list: a transcript that
  // lands while the body is being edited cannot be overwritten by an edit
  // that read the note before the transcript was written, or the reverse.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const serialize = useCallback(
    <T>(documentId: string, step: (state: Loaded) => Promise<T>) => {
      const run = queue.current.then(() => {
        const state = latest.current
        if (!state || state.documentId !== documentId) {
          throw new Error('The document changed; the change was not saved')
        }
        return step(state)
      })
      queue.current = run.catch(() => undefined)
      return run
    },
    [],
  )

  const addHighlight = useCallback(
    async (anchor: Anchor, color?: HighlightColor) => {
      if (!current) throw new Error('Annotation store is not ready')
      return serialize(current.documentId, async (state) => {
        const annotation = createHighlight({
          documentId: state.documentId,
          anchor,
          color,
        })
        await state.store.put(annotation, undefined, labelRef.current)
        apply(state.documentId, (list) => [...list, annotation])
        return annotation
      })
    },
    [current, apply, serialize],
  )

  const addNote = useCallback(
    async (input: NewNote) => {
      if (!current) throw new Error('Annotation store is not ready')
      return serialize(current.documentId, async (state) => {
        if (input.voice && !input.audio) {
          throw new Error('A voice note needs its recording')
        }
        const note: Note =
          input.kind === 'suggestion'
            ? createSuggestion({
                documentId: state.documentId,
                anchor: input.anchor,
                body: input.body,
                voice: input.voice,
                cleanUp: input.cleanUp,
              })
            : createComment({
                documentId: state.documentId,
                anchor: input.anchor,
                body: input.body,
                voice: input.voice,
                cleanUp: input.cleanUp,
              })
        await state.store.put(
          note,
          input.audio ? { id: note.id, blob: input.audio } : undefined,
          labelRef.current,
        )
        apply(state.documentId, (list) => [...list, note])
        return note
      })
    },
    [current, apply, serialize],
  )

  const updateBody = useCallback(
    async (id: string, body: string) => {
      if (!current) throw new Error('Annotation store is not ready')
      return serialize(current.documentId, async (state) => {
        const existing = state.annotations.find((a) => a.id === id)
        if (!existing || !isNote(existing)) {
          throw new Error(`No comment or suggestion with id ${id}`)
        }
        const updated = withBody(existing, body)
        await state.store.put(updated, undefined, labelRef.current)
        apply(state.documentId, (list) =>
          list.map((a) => (a.id === id ? updated : a)),
        )
        return updated
      })
    },
    [current, apply, serialize],
  )

  const updateVisibility = useCallback(
    async (id: string, visibility: Visibility) => {
      if (!current) throw new Error('Annotation store is not ready')
      return serialize(current.documentId, async (state) => {
        const existing = state.annotations.find((a) => a.id === id)
        if (!existing) throw new Error(`No annotation with id ${id}`)
        const updated = withVisibility(existing, visibility)
        await state.store.put(updated, undefined, labelRef.current)
        apply(state.documentId, (list) =>
          list.map((a) => (a.id === id ? updated : a)),
        )
        return updated
      })
    },
    [current, apply, serialize],
  )

  const updateColor = useCallback(
    async (id: string, color: HighlightColor) => {
      if (!current) throw new Error('Annotation store is not ready')
      return serialize(current.documentId, async (state) => {
        const existing = state.annotations.find((a) => a.id === id)
        if (!existing || existing.kind !== 'highlight') {
          throw new Error(`No highlight with id ${id}`)
        }
        const updated = withColor(existing, color)
        await state.store.put(updated, undefined, labelRef.current)
        apply(state.documentId, (list) =>
          list.map((a) => (a.id === id ? updated : a)),
        )
        return updated
      })
    },
    [current, apply, serialize],
  )

  const setTranscript = useCallback(
    async (id: string, transcript: Transcript) => {
      if (!current) throw new Error('Annotation store is not ready')
      return serialize(current.documentId, async (state) => {
        const existing = state.annotations.find((a) => a.id === id)
        if (!existing || !isNote(existing)) {
          throw new Error(`No comment or suggestion with id ${id}`)
        }
        const updated = withTranscript(existing, transcript)
        await state.store.put(updated, undefined, labelRef.current)
        apply(state.documentId, (list) =>
          list.map((a) => (a.id === id ? updated : a)),
        )
        return updated
      })
    },
    [current, apply, serialize],
  )

  const applyCleanUp = useCallback(
    async (id: string, proposal: CleanUpProposal) => {
      if (!current) throw new Error('Annotation store is not ready')
      return serialize(current.documentId, async (state) => {
        const existing = state.annotations.find((a) => a.id === id)
        if (!existing || !isNote(existing)) {
          throw new Error(`No comment or suggestion with id ${id}`)
        }
        const updated = withCleanUp(existing, proposal)
        await state.store.put(updated, undefined, labelRef.current)
        apply(state.documentId, (list) =>
          list.map((a) => (a.id === id ? updated : a)),
        )
        return updated
      })
    },
    [current, apply, serialize],
  )

  const changeComment = useCallback(
    async (id: string, change: (comment: Comment) => Comment) => {
      if (!current) throw new Error('Annotation store is not ready')
      return serialize(current.documentId, async (state) => {
        const existing = state.annotations.find((a) => a.id === id)
        if (!existing || existing.kind !== 'comment') {
          throw new Error(`No comment with id ${id}`)
        }
        const updated = change(existing)
        await state.store.put(updated, undefined, labelRef.current)
        apply(state.documentId, (list) =>
          list.map((a) => (a.id === id ? updated : a)),
        )
        return updated
      })
    },
    [current, apply, serialize],
  )

  const addAnswer = useCallback(
    (id: string, answer: Answer) =>
      changeComment(id, (comment) => withAnswer(comment, answer)),
    [changeComment],
  )

  const removeAnswer = useCallback(
    (id: string, answerId: string) =>
      changeComment(id, (comment) => withoutAnswer(comment, answerId)),
    [changeComment],
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
      return serialize(current.documentId, async (state) => {
        await state.store.delete(id)
        apply(state.documentId, (list) => list.filter((a) => a.id !== id))
      })
    },
    [current, apply, serialize],
  )

  const writeAndReload = useCallback(
    async <T>(write: (store: AnnotationStore) => Promise<T>) => {
      if (!current) throw new Error('Annotation store is not ready')
      return serialize(current.documentId, async (state) => {
        const result = await write(state.store)
        const annotations = await state.store.list(state.documentId)
        apply(state.documentId, () => annotations)
        return result
      })
    },
    [current, apply, serialize],
  )

  return {
    annotations: current?.annotations ?? NONE,
    ready: current !== null,
    error: failed && failed.documentId === documentId ? failed.message : null,
    addHighlight,
    addNote,
    updateBody,
    updateVisibility,
    updateColor,
    setTranscript,
    applyCleanUp,
    addAnswer,
    removeAnswer,
    getAudio,
    remove,
    writeAndReload,
  }
}
