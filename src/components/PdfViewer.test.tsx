import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RegionAnchor } from '../core/annotations'
import type { PDFDocumentProxy } from '../core/pdf'
import type { PageGeometry } from './geometry'
import { createRef } from 'react'
import { createHighlight } from '../core/annotations'
import {
  PdfViewer,
  type NewNoteRequest,
  type PdfViewerHandle,
} from './PdfViewer'

// The real page renders a PDF into a canvas, which jsdom cannot do. This
// stub registers a geometry and exposes a button that plays a region drag.
vi.mock('./PdfPage', async () => {
  const { useEffect } = await import('react')
  function PdfPage({
    pageNumber,
    active,
    onGeometry,
    onCreateRegion,
    pendingAnchor,
  }: {
    pageNumber: number
    active: boolean
    onGeometry: (page: number, g: PageGeometry | null) => void
    onCreateRegion: (anchor: RegionAnchor) => void
    pendingAnchor: RegionAnchor | null
  }) {
    useEffect(() => {
      const element = document.createElement('div')
      const geometry: PageGeometry = {
        page: pageNumber,
        element,
        textLayer: element,
        toPdfRect: () => ({ x: 0, y: 0, width: 1, height: 1 }),
        toCssRect: (r) => ({
          left: r.x,
          top: r.y,
          width: r.width,
          height: r.height,
        }),
      }
      onGeometry(pageNumber, geometry)
      return () => onGeometry(pageNumber, null)
    }, [pageNumber, onGeometry])
    return (
      <div
        data-testid={`page-${pageNumber}`}
        data-page-number={pageNumber}
        data-active={active}
      >
        {pendingAnchor && <span>pending on page {pendingAnchor.page}</span>}
        <button
          type="button"
          onClick={() =>
            onCreateRegion({
              type: 'region',
              page: pageNumber,
              rect: { x: 10, y: 20, width: 30, height: 40 },
            })
          }
        >
          drag region {pageNumber}
        </button>
      </div>
    )
  }
  return { PdfPage }
})

vi.mock('../hooks/useVoiceRecorder', () => ({
  useVoiceRecorder: () => ({
    state: { status: 'idle' },
    elapsedMs: 0,
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    discard: vi.fn(),
  }),
}))

// jsdom has no ResizeObserver; the viewer only uses it to size pages.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
  },
)

// jsdom has no IntersectionObserver; useNearPages has its own tests. This
// one lets a test report which pages are near the screen.
let reportNear: (changes: Record<number, boolean>) => void = () => {}
vi.stubGlobal(
  'IntersectionObserver',
  class {
    observed: Element[] = []
    constructor(
      callback: (entries: Partial<IntersectionObserverEntry>[]) => void,
    ) {
      reportNear = (changes) =>
        act(() =>
          callback(
            Object.entries(changes).map(([page, isIntersecting]) => ({
              target: this.observed[Number(page) - 1],
              isIntersecting,
            })),
          ),
        )
    }
    observe(element: Element) {
      this.observed.push(element)
    }
    disconnect() {}
  },
)

const pdf = { numPages: 1 } as unknown as PDFDocumentProxy

function setup(tool: 'select' | 'region' = 'region') {
  const onCreateHighlight = vi.fn()
  const onHighlightColorChange = vi.fn()
  const onCreateNote = vi.fn<(r: NewNoteRequest) => Promise<void>>(
    async () => {},
  )
  const view = render(
    <PdfViewer
      document={pdf}
      tool={tool}
      annotations={[]}
      selectedId={null}
      highlightColor="green"
      onHighlightColorChange={onHighlightColorChange}
      onCreateHighlight={onCreateHighlight}
      onCreateNote={onCreateNote}
      transcribe={null}
    />,
  )
  const rerenderWith = (nextTool: 'select' | 'region') =>
    view.rerender(
      <PdfViewer
        document={pdf}
        tool={nextTool}
        annotations={[]}
        selectedId={null}
        highlightColor="green"
        onHighlightColorChange={onHighlightColorChange}
        onCreateHighlight={onCreateHighlight}
        onCreateNote={onCreateNote}
        transcribe={null}
      />,
    )
  return {
    onCreateHighlight,
    onHighlightColorChange,
    onCreateNote,
    rerenderWith,
  }
}

describe('PdfViewer', () => {
  it('turns a region drag into a toolbar, then a highlight', () => {
    const { onCreateHighlight } = setup()
    expect(screen.queryByRole('toolbar')).toBeNull()
    fireEvent.click(screen.getByText('drag region 1'))
    expect(screen.getByRole('toolbar')).toBeTruthy()
    // Only text can be replaced: no Suggest for a region.
    expect(screen.queryByRole('button', { name: 'Suggest' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Highlight' }))
    expect(onCreateHighlight).toHaveBeenCalledWith(
      {
        type: 'region',
        page: 1,
        rect: { x: 10, y: 20, width: 30, height: 40 },
      },
      'green',
    )
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('shows the current highlight color in the toolbar and reports a new pick', () => {
    const { onHighlightColorChange, onCreateHighlight } = setup()
    fireEvent.click(screen.getByText('drag region 1'))
    expect(screen.getByRole('radio', { name: 'Green' })).toHaveProperty(
      'ariaChecked',
      'true',
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Pink' }))
    expect(onHighlightColorChange).toHaveBeenCalledWith('pink')
    // Picking a color is not highlighting: the toolbar stays for the action.
    expect(onCreateHighlight).not.toHaveBeenCalled()
    expect(screen.getByRole('toolbar')).toBeTruthy()
  })

  it('saves a typed comment on the region and keeps the composer open on failure', async () => {
    const { onCreateNote } = setup()
    onCreateNote.mockRejectedValueOnce(new Error('disk full'))
    fireEvent.click(screen.getByText('drag region 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    expect(screen.getByText('pending on page 1')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), {
      target: { value: 'Axis labels are missing' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'disk full',
    )
    expect(onCreateNote).toHaveBeenCalledWith({
      kind: 'comment',
      body: 'Axis labels are missing',
      anchor: {
        type: 'region',
        page: 1,
        rect: { x: 10, y: 20, width: 30, height: 40 },
      },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() =>
      expect(screen.queryByRole('form', { name: 'New comment' })).toBeNull(),
    )
    expect(screen.queryByText('pending on page 1')).toBeNull()
  })

  it('drops a pending region and an open composer when the tool changes', () => {
    const { rerenderWith } = setup()
    fireEvent.click(screen.getByText('drag region 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    expect(screen.getByRole('form', { name: 'New comment' })).toBeTruthy()

    rerenderWith('select')
    expect(screen.queryByRole('form', { name: 'New comment' })).toBeNull()
    expect(screen.queryByText('pending on page 1')).toBeNull()

    // Nothing stale comes back with the tool.
    rerenderWith('region')
    expect(screen.queryByRole('toolbar')).toBeNull()
    expect(screen.queryByRole('form', { name: 'New comment' })).toBeNull()
  })

  it('dismisses a pending region on a tap elsewhere, but not on the toolbar', () => {
    setup()
    fireEvent.click(screen.getByText('drag region 1'))
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Comment' }))
    expect(screen.getByRole('toolbar')).toBeTruthy()
    fireEvent.pointerDown(screen.getByTestId('page-1'))
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it("scrolls to an annotation's mark when rendered, else to its page", () => {
    const scrolled: Element[] = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    try {
      const ref = createRef<PdfViewerHandle>()
      const a = createHighlight({
        documentId: 'd',
        anchor: {
          type: 'region',
          page: 1,
          rect: { x: 0, y: 0, width: 1, height: 1 },
        },
      })
      const { container } = render(
        <PdfViewer
          ref={ref}
          document={pdf}
          tool="select"
          annotations={[a]}
          selectedId={null}
          highlightColor="yellow"
          onHighlightColorChange={vi.fn()}
          onCreateHighlight={vi.fn()}
          onCreateNote={vi.fn(async () => {})}
          transcribe={null}
        />,
      )
      // The stubbed page draws no marks: the page element gets the scroll.
      ref.current?.scrollToAnnotation(a)
      expect(scrolled).toHaveLength(1)
      expect(scrolled[0].hasAttribute('data-annotation-id')).toBe(false)

      const mark = document.createElement('div')
      mark.setAttribute('data-annotation-id', a.id)
      container.querySelector('.pdf-viewer')?.appendChild(mark)
      ref.current?.scrollToAnnotation(a)
      expect(scrolled[1]).toBe(mark)
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('renders only pages near the screen, plus the page under the toolbar', () => {
    render(
      <PdfViewer
        document={{ numPages: 3 } as unknown as PDFDocumentProxy}
        tool="region"
        annotations={[]}
        selectedId={null}
        highlightColor="yellow"
        onHighlightColorChange={vi.fn()}
        onCreateHighlight={vi.fn()}
        onCreateNote={vi.fn(async () => {})}
        transcribe={null}
      />,
    )
    const active = () =>
      [1, 2, 3].filter(
        (n) =>
          screen.getByTestId(`page-${n}`).getAttribute('data-active') ===
          'true',
      )
    expect(active()).toEqual([])
    reportNear({ 1: true, 2: true })
    expect(active()).toEqual([1, 2])

    // A region on page 2 keeps it rendered after it scrolls far away.
    fireEvent.click(screen.getByText('drag region 2'))
    reportNear({ 1: false, 2: false, 3: true })
    expect(active()).toEqual([2, 3])
    fireEvent.pointerDown(screen.getByTestId('page-3'))
    expect(screen.queryByRole('toolbar')).toBeNull()
    expect(active()).toEqual([3])
  })
})
