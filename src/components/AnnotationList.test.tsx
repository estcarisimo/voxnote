import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  createComment,
  createHighlight,
  createSuggestion,
  withVisibility,
  type Annotation,
  type Note,
  type TextAnchor,
  type Visibility,
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
  onUpdateVisibility: async () => {},
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
      throw new Error('Add your OpenAI key in AI keys first')
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
      'Add your OpenAI key in AI keys first',
    )
  })

  it('offers Clean up… only beside a raw transcript, and marks a cleaned body', async () => {
    const voice = {
      mimeType: 'audio/webm',
      durationMs: 1000,
      recordedAt: '2026-10-29T10:00:00.000Z',
      transcript: {
        raw: 'um the claim is uh weak',
        provider: 'openai/gpt-transcribe',
        transcribedAt: '2026-10-29T10:01:00.000Z',
      },
    }
    const dictated = createComment({
      documentId: 'd',
      anchor,
      body: voice.transcript.raw,
      voice,
    })
    const cleaned = createComment({
      documentId: 'd',
      anchor: { ...anchor, page: 4 },
      body: 'The claim is weak.',
      voice,
      cleanUp: {
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        createdAt: '2026-10-29T10:02:00.000Z',
        promptVersion: 1,
        editedAfter: true,
      },
    })
    const untranscribed = createComment({
      documentId: 'd',
      anchor,
      body: '',
      voice: { ...voice, transcript: undefined },
    })
    const typed = createComment({ documentId: 'd', anchor, body: 'typed' })
    const onCleanUp = vi.fn(async () => {
      throw new Error('Add your Anthropic (Claude) key in AI keys first')
    })
    render(
      <AnnotationList
        annotations={[dictated, cleaned, untranscribed, typed]}
        selectedId={null}
        {...noop}
        onCleanUp={onCleanUp}
      />,
    )
    const buttons = screen.getAllByRole('button', { name: 'Clean up…' })
    expect(buttons).toHaveLength(2)
    expect(
      screen.getByText(
        '✨ Cleaned up with anthropic/claude-opus-5-5, then edited',
      ),
    ).toBeTruthy()
    fireEvent.click(buttons[0])
    expect(onCleanUp).toHaveBeenCalledWith(dictated)
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Add your Anthropic (Claude) key in AI keys first',
    )
  })

  it('offers no Clean up… without a handler', () => {
    const comment = createComment({
      documentId: 'd',
      anchor,
      body: 'x',
      voice: {
        mimeType: 'audio/webm',
        durationMs: 1000,
        recordedAt: '2026-10-29T10:00:00.000Z',
        transcript: {
          raw: 'x',
          provider: 'openai/gpt-transcribe',
          transcribedAt: '2026-10-29T10:01:00.000Z',
        },
      },
    })
    render(
      <AnnotationList annotations={[comment]} selectedId={null} {...noop} />,
    )
    expect(screen.queryByRole('button', { name: 'Clean up…' })).toBeNull()
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

  it('groups by kind with headings and counts, and switches to page grouping', () => {
    const onP1 = { ...anchor, page: 1 }
    const h = createHighlight({ documentId: 'd', anchor })
    const c = createComment(
      { documentId: 'd', anchor: onP1, body: 'note' },
      new Date('2026-10-29T10:00:00.000Z'),
    )
    const s = createSuggestion(
      { documentId: 'd', anchor: onP1, body: 'fix' },
      new Date('2026-10-29T10:01:00.000Z'),
    )
    render(
      <AnnotationList annotations={[h, c, s]} selectedId={null} {...noop} />,
    )
    const headings = screen.getAllByRole('heading', { level: 3 })
    expect(headings.map((e) => e.textContent)).toEqual([
      'Suggestions1',
      'Comments1',
      'Highlights1',
    ])
    // The count is decoration for screen readers: the heading name is the label.
    expect(
      screen.getByRole('heading', { level: 3, name: 'Comments' }),
    ).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Group by'), {
      target: { value: 'page' },
    })
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((e) => e.textContent),
    ).toEqual(['Page 12', 'Page 31'])
    // Within page 1 the suggestion and comment share a position: creation
    // order wins, so the comment (created first) comes first.
    const items = screen.getAllByRole('listitem')
    expect(items[0].textContent).toContain('note')
    expect(items[1].textContent).toContain('fix')
  })

  it('filters by kind chips, visibility, untranscribed voice and text, with a clear action', () => {
    const h = createHighlight({ documentId: 'd', anchor })
    const c = withVisibility(
      createComment({ documentId: 'd', anchor, body: 'Cite the source' }),
      'author-facing',
    )
    const v = createComment({
      documentId: 'd',
      anchor,
      body: '',
      voice: {
        mimeType: 'audio/webm',
        durationMs: 1000,
        recordedAt: '2026-10-29T10:00:00.000Z',
      },
    })
    render(
      <AnnotationList annotations={[h, c, v]} selectedId={null} {...noop} />,
    )
    const chip = (name: string) => screen.getByRole('button', { name })

    fireEvent.click(chip('Highlights'))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('1 of 3')).toBeTruthy()
    expect(chip('Highlights').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(chip('Highlights'))
    expect(screen.getAllByRole('listitem')).toHaveLength(3)

    fireEvent.click(chip('For the author'))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('Cite the source')).toBeTruthy()
    fireEvent.click(chip('Private'))
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    fireEvent.click(chip('Private'))

    fireEvent.click(chip('🎤 Untranscribed'))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('Voice note, not transcribed yet')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Search annotations'), {
      target: { value: 'SOURCE' },
    })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText(/No annotations match the filter/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.queryByText(/of 3/)).toBeNull()
  })

  it('toggles visibility through the callback and shows a failure without flipping', async () => {
    const h = createHighlight({ documentId: 'd', anchor })
    const onUpdateVisibility = vi
      .fn<(a: Annotation, v: Visibility) => Promise<void>>()
      .mockRejectedValueOnce(new Error('store closed'))
    const { rerender } = render(
      <AnnotationList
        annotations={[h]}
        selectedId={null}
        {...noop}
        onUpdateVisibility={onUpdateVisibility}
      />,
    )
    const toggle = screen.getByRole('button', { name: '🔒 Private' })
    expect(toggle.getAttribute('data-visibility')).toBe('private')
    expect(toggle.title).toMatch(/exports still include it/)
    fireEvent.click(toggle)
    expect(onUpdateVisibility).toHaveBeenCalledWith(h, 'author-facing')
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'store closed',
    )
    expect(screen.getByRole('button', { name: '🔒 Private' })).toBeTruthy()

    // The parent stores the change and re-renders with the new value.
    rerender(
      <AnnotationList
        annotations={[withVisibility(h, 'author-facing')]}
        selectedId={null}
        {...noop}
        onUpdateVisibility={onUpdateVisibility}
      />,
    )
    const shared = screen.getByRole('button', { name: '✉ For author' })
    expect(shared.getAttribute('data-visibility')).toBe('author-facing')
    fireEvent.click(shared)
    expect(onUpdateVisibility).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: h.id, visibility: 'author-facing' }),
      'private',
    )
  })

  it('selects an annotation from a group', () => {
    const h = createHighlight({ documentId: 'd', anchor })
    const onSelect = vi.fn()
    render(
      <AnnotationList
        annotations={[h]}
        selectedId={null}
        {...noop}
        onSelect={onSelect}
      />,
    )
    fireEvent.click(screen.getByText('quoted words'))
    expect(onSelect).toHaveBeenCalledWith(h)
  })
})
