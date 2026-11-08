import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from '../core/pdf'
import type { PageGeometry } from './geometry'
import { PdfPage, RENDER_DELAY_MS } from './PdfPage'

// The text layer only needs to put something in its container.
vi.mock('pdfjs-dist', () => ({
  TextLayer: class {
    options: { container: HTMLElement }
    constructor(options: { container: HTMLElement }) {
      this.options = options
    }
    async render() {
      const span = document.createElement('span')
      span.textContent = 'text'
      this.options.container.appendChild(span)
    }
    cancel() {}
  },
}))

// A US Letter page at scale 1; jsdom cannot draw, so render() only records.
function fakeDocument() {
  const renders: { cancel: ReturnType<typeof vi.fn> }[] = []
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({
      width: 612 * scale,
      height: 792 * scale,
      viewBox: [0, 0, 612, 792],
      convertToPdfPoint: (x: number, y: number) => [x, y],
      convertToViewportPoint: (x: number, y: number) => [x, y],
    }),
    render: vi.fn(() => {
      const task = { promise: Promise.resolve(), cancel: vi.fn() }
      renders.push(task)
      return task
    }),
    streamTextContent: () => new ReadableStream(),
    cleanup: vi.fn(),
  }
  const document = {
    getPage: vi.fn(async () => page),
  } as unknown as PDFDocumentProxy
  return { document, page, renders }
}

const getContext = HTMLCanvasElement.prototype.getContext

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => ({
    setTransform() {},
  })) as unknown as typeof getContext
})

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = getContext
})

function renderPage(document: PDFDocumentProxy, active: boolean) {
  const onGeometry = vi.fn<(page: number, g: PageGeometry | null) => void>()
  const page = (a: boolean) => (
    <PdfPage
      document={document}
      pageNumber={3}
      width={306}
      active={a}
      tool="select"
      annotations={[]}
      selectedId={null}
      pendingAnchor={null}
      onGeometry={onGeometry}
      onCreateRegion={() => {}}
    />
  )
  const view = render(page(active))
  const root = view.container.querySelector<HTMLDivElement>('.pdf-page')!
  return {
    root,
    canvas: root.querySelector('canvas')!,
    textLayer: root.querySelector('.textLayer')!,
    onGeometry,
    setActive: (a: boolean) => view.rerender(page(a)),
  }
}

const lastGeometry = (onGeometry: ReturnType<typeof vi.fn>) =>
  onGeometry.mock.calls.at(-1)?.[1] ?? null

describe('PdfPage render window', () => {
  it('sizes an inactive page without drawing it', async () => {
    const { document, page } = fakeDocument()
    const { root, canvas } = renderPage(document, false)
    // Half of a Letter page's width gives half its height.
    expect(root.hasAttribute('data-sized')).toBe(false)
    await waitFor(() => expect(root.style.height).toBe('396px'))
    // Marked once the real height is in: crash resume waits for it.
    expect(root.getAttribute('data-sized')).toBe('true')
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS * 2))
    expect(page.render).not.toHaveBeenCalled()
    expect(canvas.width).toBe(0)
    expect(canvas.height).toBe(0)
  })

  it('draws an active page and reports its geometry', async () => {
    const { document, page } = fakeDocument()
    const { canvas, textLayer, onGeometry } = renderPage(document, true)
    await waitFor(() => expect(lastGeometry(onGeometry)).not.toBeNull())
    expect(page.render).toHaveBeenCalledTimes(1)
    const dpr = window.devicePixelRatio || 1
    expect(canvas.width).toBe(Math.floor(306 * dpr))
    expect(textLayer.childElementCount).toBe(1)
  })

  it('releases the canvas and text layer when the page goes far', async () => {
    const { document, page } = fakeDocument()
    const { canvas, textLayer, onGeometry, setActive } = renderPage(
      document,
      true,
    )
    await waitFor(() => expect(lastGeometry(onGeometry)).not.toBeNull())
    setActive(false)
    expect(canvas.width).toBe(0)
    expect(canvas.height).toBe(0)
    expect(textLayer.childElementCount).toBe(0)
    expect(lastGeometry(onGeometry)).toBeNull()
    expect(page.cleanup).toHaveBeenCalled()
  })

  it('never draws a page that passes by faster than the render delay', async () => {
    const { document, page } = fakeDocument()
    const { setActive } = renderPage(document, true)
    setActive(false)
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS * 2))
    expect(page.render).not.toHaveBeenCalled()
  })

  it('yields to the browser between render slices', async () => {
    const { document, renders } = fakeDocument()
    const { onGeometry } = renderPage(document, true)
    await waitFor(() => expect(lastGeometry(onGeometry)).not.toBeNull())
    const task = renders[0] as unknown as {
      onContinue?: (next: () => void) => void
    }
    expect(task.onContinue).toBeTypeOf('function')
    const next = vi.fn()
    task.onContinue!(next)
    expect(next).not.toHaveBeenCalled()
    await waitFor(() => expect(next).toHaveBeenCalledTimes(1))
  })
})
