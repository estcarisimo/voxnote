import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RegionAnchor } from '../core/annotations'
import type { PDFDocumentProxy } from '../core/pdf'
import type { PageGeometry } from './geometry'
import { PdfViewer, type NewCommentRequest } from './PdfViewer'

// The real page renders a PDF into a canvas, which jsdom cannot do. This
// stub registers a geometry and exposes a button that plays a region drag.
vi.mock('./PdfPage', async () => {
  const { useEffect } = await import('react')
  function PdfPage({
    pageNumber,
    onGeometry,
    onCreateRegion,
    pendingAnchor,
  }: {
    pageNumber: number
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
      <div data-testid={`page-${pageNumber}`}>
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

const pdf = { numPages: 1 } as unknown as PDFDocumentProxy

function setup(tool: 'select' | 'region' = 'region') {
  const onCreateHighlight = vi.fn()
  const onCreateComment = vi.fn<(r: NewCommentRequest) => Promise<void>>(
    async () => {},
  )
  const view = render(
    <PdfViewer
      document={pdf}
      tool={tool}
      annotations={[]}
      selectedId={null}
      onCreateHighlight={onCreateHighlight}
      onCreateComment={onCreateComment}
    />,
  )
  const rerenderWith = (nextTool: 'select' | 'region') =>
    view.rerender(
      <PdfViewer
        document={pdf}
        tool={nextTool}
        annotations={[]}
        selectedId={null}
        onCreateHighlight={onCreateHighlight}
        onCreateComment={onCreateComment}
      />,
    )
  return { onCreateHighlight, onCreateComment, rerenderWith }
}

describe('PdfViewer', () => {
  it('turns a region drag into a toolbar, then a highlight', () => {
    const { onCreateHighlight } = setup()
    expect(screen.queryByRole('toolbar')).toBeNull()
    fireEvent.click(screen.getByText('drag region 1'))
    expect(screen.getByRole('toolbar')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Highlight' }))
    expect(onCreateHighlight).toHaveBeenCalledWith({
      type: 'region',
      page: 1,
      rect: { x: 10, y: 20, width: 30, height: 40 },
    })
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('saves a typed comment on the region and keeps the composer open on failure', async () => {
    const { onCreateComment } = setup()
    onCreateComment.mockRejectedValueOnce(new Error('disk full'))
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
    expect(onCreateComment).toHaveBeenCalledWith({
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
})
