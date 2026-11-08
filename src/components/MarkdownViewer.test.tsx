import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createComment, createHighlight } from '../core/annotations'
import { parseMarkdown } from '../core/markdown'
import { MarkdownViewer, type MarkdownViewerHandle } from './MarkdownViewer'
import type { Draft } from '../core/recoveryStore'
import type { DraftKeeper } from '../hooks/useDraft'
import type { NewNoteRequest } from './PdfViewer'

const DOC = parseMarkdown(
  '# Title\n\nThe claim is weak and *needs* a citation.\n',
)

function selectInBlock(ordinal: number, start: number, end: number) {
  const block = document.querySelector(`[data-block="${ordinal}"]`)!
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  const text = walker.nextNode()!
  const range = document.createRange()
  range.setStart(text, start)
  range.setEnd(text, end)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
}

function renderViewer(
  overrides: Partial<Parameters<typeof MarkdownViewer>[0]> = {},
) {
  const onCreateHighlight = vi.fn()
  const onCreateNote = vi.fn<(r: NewNoteRequest) => Promise<void>>(() =>
    Promise.resolve(),
  )
  const ref = createRef<MarkdownViewerHandle>()
  const utils = render(
    <MarkdownViewer
      ref={ref}
      document={DOC}
      annotations={[]}
      selectedId={null}
      highlightColor="yellow"
      onHighlightColorChange={() => {}}
      onCreateHighlight={onCreateHighlight}
      onCreateNote={onCreateNote}
      transcribe={null}
      {...overrides}
    />,
  )
  return { ...utils, onCreateHighlight, onCreateNote, ref }
}

beforeEach(() => {
  // jsdom lays nothing out: ranges have no rectangles and nothing resizes,
  // so the toolbar is placed at the origin and the marks layer stays empty.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  Range.prototype.getBoundingClientRect ??= () =>
    ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
})

afterEach(() => {
  window.getSelection()?.removeAllRanges()
})

describe('MarkdownViewer', () => {
  it('renders the document', () => {
    renderViewer()
    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy()
  })

  it('offers the toolbar for a selection inside one block and saves a highlight', async () => {
    const { onCreateHighlight } = renderViewer()
    selectInBlock(2, 4, 9) // "claim"
    const toolbar = await screen.findByRole('toolbar', {
      name: 'Selection actions',
    })
    expect(toolbar).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Highlight' }))
    expect(onCreateHighlight).toHaveBeenCalledWith(
      { type: 'block-text', page: 2, quote: 'claim', start: 4, end: 9 },
      'yellow',
    )
    await waitFor(() => expect(screen.queryByRole('toolbar')).toBeNull())
  })

  it('saves a typed comment and a suggestion on the selected passage', async () => {
    const { onCreateNote } = renderViewer()
    selectInBlock(2, 0, 9) // "The claim"
    await screen.findByRole('toolbar')
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    const editor = await screen.findByRole('textbox')
    fireEvent.change(editor, { target: { value: 'Which claim?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onCreateNote).toHaveBeenCalledTimes(1))
    expect(onCreateNote.mock.calls[0]![0]).toMatchObject({
      kind: 'comment',
      body: 'Which claim?',
      anchor: {
        type: 'block-text',
        page: 2,
        quote: 'The claim',
        start: 0,
        end: 9,
      },
    })

    selectInBlock(2, 0, 9)
    await screen.findByRole('toolbar')
    fireEvent.click(screen.getByRole('button', { name: 'Suggest' }))
    const replacement = await screen.findByRole('textbox')
    fireEvent.change(replacement, { target: { value: 'The result' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onCreateNote).toHaveBeenCalledTimes(2))
    expect(onCreateNote.mock.calls[1]![0]).toMatchObject({
      kind: 'suggestion',
      body: 'The result',
      anchor: { type: 'block-text', page: 2, quote: 'The claim' },
    })
  })

  it('offers nothing for a selection across two blocks', async () => {
    renderViewer()
    const h1 = document.querySelector('[data-block="1"]')!.firstChild!
    const p = document.querySelector('[data-block="2"]')!.firstChild!
    const range = document.createRange()
    range.setStart(h1, 0)
    range.setEnd(p, 3)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await new Promise((r) => setTimeout(r, 200))
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('reports an annotation whose anchor does not fit the document instead of hiding it', () => {
    const stale = createHighlight({
      documentId: 'doc',
      anchor: { type: 'block-text', page: 2, quote: 'x', start: 0, end: 999 },
    })
    const missing = createHighlight({
      documentId: 'doc',
      anchor: { type: 'block-text', page: 9, quote: 'x', start: 0, end: 1 },
    })
    const pdf = createComment({
      documentId: 'doc',
      body: 'from a PDF',
      anchor: {
        type: 'text',
        page: 1,
        quote: 'q',
        rects: [{ x: 0, y: 0, width: 1, height: 1 }],
      },
    })
    renderViewer({ annotations: [stale, missing, pdf] })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(
      `Annotation ${stale.id} could not be placed`,
    )
    expect(alert.textContent).toContain(
      `Annotation ${missing.id} points at block 9`,
    )
    expect(alert.textContent).toContain(
      `Annotation ${pdf.id} has a text anchor`,
    )
  })

  it('shows no error for anchors that fit', () => {
    const ok = createHighlight({
      documentId: 'doc',
      anchor: { type: 'block-text', page: 2, quote: 'claim', start: 4, end: 9 },
    })
    renderViewer({ annotations: [ok] })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('scrolls to the block of an annotation without rendered marks', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const ok = createHighlight({
      documentId: 'doc',
      anchor: { type: 'block-text', page: 2, quote: 'claim', start: 4, end: 9 },
    })
    const { ref } = renderViewer({ annotations: [ok] })
    ref.current!.scrollToAnnotation(ok)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    const target = scrollIntoView.mock.contexts[0] as Element
    expect(target.getAttribute('data-block')).toBe('2')
  })
})

describe('MarkdownViewer draft keeping', () => {
  const anchor = {
    type: 'block-text',
    page: 2,
    quote: 'The claim',
    start: 0,
    end: 9,
  } as const

  function keeper(restored: Draft | null): DraftKeeper {
    return {
      ready: true,
      restored,
      error: null,
      begin: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    }
  }

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:restored')
    URL.revokeObjectURL = vi.fn()
  })

  it('starts a draft when a composer opens and drops it on Cancel', async () => {
    const drafts = keeper(null)
    renderViewer({ drafts })
    selectInBlock(2, 0, 9)
    await screen.findByRole('toolbar')
    fireEvent.click(screen.getByRole('button', { name: 'Suggest' }))
    expect(drafts.begin).toHaveBeenCalledWith({
      mode: 'suggest',
      anchor,
      placement: expect.any(Object),
      body: 'The claim',
    })
    fireEvent.change(await screen.findByRole('textbox'), {
      target: { value: 'A claim' },
    })
    expect(drafts.update).toHaveBeenLastCalledWith({
      body: 'A claim',
      transcript: undefined,
      cleanUp: undefined,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(drafts.remove).toHaveBeenCalledTimes(1)
  })

  it('reopens a restored voice draft with its recording, and saves it', async () => {
    const blob = new Blob(['opus'], { type: 'audio/webm' })
    const drafts = keeper({
      documentId: 'doc',
      mode: 'voice',
      anchor,
      placement: { left: 0, top: 0, bottom: 0 },
      body: 'Said before the crash',
      audio: {
        blob,
        mimeType: 'audio/webm',
        durationMs: 2500,
        recordedAt: '2026-11-07T09:59:00.000Z',
        complete: false,
      },
      updatedAt: '2026-11-07T10:00:00.000Z',
    })
    const { onCreateNote } = renderViewer({ drafts })
    expect(screen.getByRole('textbox')).toHaveProperty(
      'value',
      'Said before the crash',
    )
    expect(screen.getByRole('status').textContent).toContain(
      'Draft restored (saved 2026-11-07 10:00 UTC)',
    )
    await waitFor(() =>
      expect(document.querySelector('audio')?.getAttribute('src')).toBe(
        'blob:restored',
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onCreateNote).toHaveBeenCalledTimes(1))
    expect(onCreateNote.mock.calls[0]![0]).toMatchObject({
      kind: 'comment',
      anchor,
      body: 'Said before the crash',
      audio: blob,
      voice: { mimeType: 'audio/webm', durationMs: 2500 },
    })
    expect(drafts.remove).toHaveBeenCalledTimes(1)
  })

  it('discards a restored draft on request', async () => {
    const drafts = keeper({
      documentId: 'doc',
      mode: 'typed',
      anchor,
      placement: { left: 0, top: 0, bottom: 0 },
      body: 'Old thought',
      updatedAt: '2026-11-07T10:00:00.000Z',
    })
    renderViewer({ drafts })
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    expect(drafts.remove).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
