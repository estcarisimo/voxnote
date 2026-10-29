import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  createComment,
  createHighlight,
  createSuggestion,
  type Note,
  type TextAnchor,
} from '../core/annotations'
import { AnnotationList } from './AnnotationList'

const anchor: TextAnchor = {
  type: 'text',
  page: 3,
  quote: 'quoted words',
  rects: [{ x: 0, y: 0, width: 10, height: 10 }],
}

const noop = {
  onSelect: () => {},
  onDelete: () => {},
  onUpdateBody: async () => {},
  onLoadAudio: async () => null,
  onTranscribe: async () => {},
}

describe('AnnotationList', () => {
  it('renders highlights and comments differently', () => {
    const h = createHighlight({ documentId: 'd', anchor })
    const c = createComment({ documentId: 'd', anchor, body: 'Needs a ref' })
    render(<AnnotationList annotations={[h, c]} selectedId={null} {...noop} />)
    expect(screen.getAllByText('quoted words')).toHaveLength(2)
    expect(screen.getByText('Needs a ref')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Delete highlight on page 3' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Delete comment on page 3' }),
    ).toBeTruthy()
  })

  it('edits a comment body and surfaces a failed save', async () => {
    const c = createComment({ documentId: 'd', anchor, body: 'old' })
    const onUpdateBody = vi
      .fn<(c: Note, body: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('store closed'))
      .mockResolvedValueOnce(undefined)
    render(
      <AnnotationList
        annotations={[c]}
        selectedId={null}
        {...noop}
        onUpdateBody={onUpdateBody}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const editor = screen.getByLabelText('Edit comment')
    fireEvent.change(editor, { target: { value: 'new' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'store closed',
    )
    expect(onUpdateBody).toHaveBeenCalledWith(c, 'new')

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() =>
      expect(screen.queryByLabelText('Edit comment')).toBeNull(),
    )
  })

  it('loads a voice note on demand and fails loudly when it is missing', async () => {
    const c = createComment({
      documentId: 'd',
      anchor,
      body: '',
      voice: {
        mimeType: 'audio/webm',
        durationMs: 65_000,
        recordedAt: '2026-10-29T10:00:00.000Z',
      },
    })
    const onLoadAudio = vi.fn(async () => null)
    render(
      <AnnotationList
        annotations={[c]}
        selectedId={null}
        {...noop}
        onLoadAudio={onLoadAudio}
      />,
    )
    expect(screen.getByText(/🎤 1:05/)).toBeTruthy()
    expect(screen.getByText('Voice note, not transcribed yet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '▶ Play' }))
    expect(onLoadAudio).toHaveBeenCalledWith(c)
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'The recording is missing from local storage',
    )
  })

  it('offers Transcribe… only for voice notes without a transcript and shows failures', async () => {
    const voice = {
      mimeType: 'audio/webm',
      durationMs: 1000,
      recordedAt: '2026-10-29T10:00:00.000Z',
    }
    const pending = createComment({ documentId: 'd', anchor, body: '', voice })
    const done = createComment({
      documentId: 'd',
      anchor,
      body: 'ya',
      voice: {
        ...voice,
        transcript: {
          raw: 'ya',
          provider: 'openai/gpt-transcribe',
          transcribedAt: '2026-10-29T10:01:00.000Z',
        },
      },
    })
    const typed = createComment({ documentId: 'd', anchor, body: 'typed' })
    const onTranscribe = vi.fn(async () => {
      throw new Error('Add your OpenAI API key under Providers first')
    })
    render(
      <AnnotationList
        annotations={[pending, done, typed]}
        selectedId={null}
        {...noop}
        onTranscribe={onTranscribe}
      />,
    )
    const buttons = screen.getAllByRole('button', { name: 'Transcribe…' })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0])
    expect(onTranscribe).toHaveBeenCalledWith(pending)
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Add your OpenAI API key under Providers first',
    )
  })

  it('shows a suggestion as original struck through and replacement inserted, and edits need a change', async () => {
    const s = createSuggestion({ documentId: 'd', anchor, body: 'quoted word' })
    const onUpdateBody = vi.fn(async () => {})
    render(
      <AnnotationList
        annotations={[s]}
        selectedId={null}
        {...noop}
        onUpdateBody={onUpdateBody}
      />,
    )
    expect(screen.getByText('quoted words').tagName).toBe('DEL')
    expect(screen.getByText('quoted word').tagName).toBe('INS')
    expect(
      screen.getByRole('button', { name: 'Delete suggestion on page 3' }),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Transcribe…' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const editor = screen.getByLabelText('Edit replacement')
    fireEvent.change(editor, { target: { value: 'quoted words' } })
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty(
      'disabled',
      true,
    )
    fireEvent.change(editor, { target: { value: 'quoted phrases' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() =>
      expect(onUpdateBody).toHaveBeenCalledWith(s, 'quoted phrases'),
    )
  })
})
