import { describe, expect, it, vi } from 'vitest'
import { createComment, type TextAnchor } from '../core/annotations'
import { deliverTranscript } from './deliverTranscript'

const anchor: TextAnchor = {
  type: 'text',
  page: 1,
  quote: 'q',
  rects: [{ x: 0, y: 0, width: 1, height: 1 }],
}
const note = createComment({
  documentId: 'doc-a',
  anchor,
  body: '',
  voice: {
    mimeType: 'audio/webm',
    durationMs: 1000,
    recordedAt: '2026-10-30T10:00:00.000Z',
  },
})
const transcript = {
  raw: 'llegó tarde',
  provider: 'openai/gpt-transcribe',
  transcribedAt: '2026-10-30T10:00:04.000Z',
}

function target(documentId: string | null = 'doc-a') {
  return {
    currentDocumentId: vi.fn(() => documentId),
    setTranscript: vi.fn(async () => {}),
    onArrival: vi.fn(),
  }
}

describe('deliverTranscript', () => {
  it('marks the note pending, then writes the transcript through the stored-note path', async () => {
    const t = target()
    await deliverTranscript(note, Promise.resolve(transcript), t)
    expect(t.onArrival.mock.calls).toEqual([
      [note.id, { status: 'pending' }],
      [note.id, null],
    ])
    expect(t.setTranscript).toHaveBeenCalledWith(note.id, transcript)
  })

  it('clears quietly when the request was cancelled', async () => {
    const t = target()
    await deliverTranscript(note, Promise.resolve(null), t)
    expect(t.setTranscript).not.toHaveBeenCalled()
    expect(t.onArrival).toHaveBeenLastCalledWith(note.id, null)
  })

  it('refuses to write into another document and says so on the note', async () => {
    const t = target('doc-b')
    await deliverTranscript(note, Promise.resolve(transcript), t)
    expect(t.setTranscript).not.toHaveBeenCalled()
    expect(t.onArrival).toHaveBeenLastCalledWith(note.id, {
      status: 'error',
      message:
        'Transcription failed: The document changed; the transcript was not saved',
    })
  })

  it('shows an upload failure or a refused write on the note, never rejecting', async () => {
    const t = target()
    await expect(
      deliverTranscript(note, Promise.reject(new Error('OpenAI said 500')), t),
    ).resolves.toBeUndefined()
    expect(t.onArrival).toHaveBeenLastCalledWith(note.id, {
      status: 'error',
      message: 'Transcription failed: OpenAI said 500',
    })

    const refused = target()
    refused.setTranscript.mockRejectedValueOnce(new Error('quota exceeded'))
    await deliverTranscript(note, Promise.resolve(transcript), refused)
    expect(refused.onArrival).toHaveBeenLastCalledWith(note.id, {
      status: 'error',
      message: 'Transcription failed: quota exceeded',
    })
  })
})
