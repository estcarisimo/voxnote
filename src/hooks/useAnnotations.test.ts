// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Annotation, TextAnchor } from '../core/annotations'
import type { AnnotationStore } from '../core/store'
import { useAnnotations } from './useAnnotations'

// An in-memory store: this test is about React state, not IndexedDB.
vi.mock('../core/store', () => ({
  openAnnotationStore: async (): Promise<AnnotationStore> => {
    const rows = new Map<string, Annotation>()
    return {
      list: async (documentId) =>
        [...rows.values()].filter((a) => a.documentId === documentId),
      put: async (annotation) => {
        rows.set(annotation.id, annotation)
      },
      getAudio: async () => null,
      delete: async (id) => {
        rows.delete(id)
      },
      close: () => {},
    }
  },
}))

const anchor: TextAnchor = {
  type: 'text',
  page: 1,
  quote: 'q',
  rects: [{ x: 0, y: 0, width: 1, height: 1 }],
}

describe('useAnnotations', () => {
  it('attaches a transcript to a note saved a moment ago, even through the previous render’s callbacks', async () => {
    const { result } = renderHook(() => useAnnotations('doc-a'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    // Callbacks from before the save, as a transcript arriving early holds.
    const before = result.current
    const transcript = {
      raw: 'llegó antes del render',
      provider: 'openai/gpt-transcribe',
      transcribedAt: '2026-10-30T10:00:04.000Z',
    }
    await act(async () => {
      const note = await before.addNote({
        kind: 'comment',
        anchor,
        body: '',
        voice: {
          mimeType: 'audio/webm',
          durationMs: 1000,
          recordedAt: '2026-10-30T10:00:00.000Z',
        },
        audio: new Blob(['opus'], { type: 'audio/webm' }),
      })
      const updated = await before.setTranscript(note.id, transcript)
      expect(updated.body).toBe('llegó antes del render')
    })
    expect(result.current.annotations).toHaveLength(1)
    const [saved] = result.current.annotations
    expect(saved.kind === 'comment' && saved.voice?.transcript).toEqual(
      transcript,
    )
  })
})
