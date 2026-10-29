import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import {
  clampToViewBox,
  createPageGeometry,
  type ViewportLike,
} from './geometry'

/**
 * Real pdf.js viewports, built in Node from a generated PDF, so the y flip,
 * rotation and media-box offset are the library's own math, not a stub.
 */
async function realViewport(
  rotation: number,
  mediaBox: [number, number, number, number] = [0, 0, 400, 600],
  scale = 2,
): Promise<ViewportLike> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await PDFDocument.create()
  const page = doc.addPage([
    mediaBox[2] - mediaBox[0],
    mediaBox[3] - mediaBox[1],
  ])
  page.setMediaBox(
    mediaBox[0],
    mediaBox[1],
    mediaBox[2] - mediaBox[0],
    mediaBox[3] - mediaBox[1],
  )
  const pdf = await pdfjs.getDocument({ data: await doc.save() }).promise
  return (await pdf.getPage(1)).getViewport({ scale, rotation })
}

/** A page element placed at (100, 50) in the client viewport. */
const element = {
  getBoundingClientRect: () => ({ left: 100, top: 50 }),
} as unknown as HTMLElement

const client = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
})

const close = (actual: object, expected: Record<string, number>) => {
  const values = actual as Record<string, number>
  for (const key of Object.keys(expected)) {
    expect(values[key]).toBeCloseTo(expected[key], 6)
  }
}

describe('createPageGeometry with real pdf.js viewports', () => {
  it('maps client → PDF with the y axis flipped, scale and element offset removed', async () => {
    const g = createPageGeometry(1, element, element, await realViewport(0))
    // 20×10 CSS px box at page-relative (40, 60) on a 800×1200 px canvas
    // (scale 2) → 10×5 pt at x=20, with y measured from the bottom:
    // top edge is 60 px = 30 pt from the top → 570 pt; bottom edge 565 pt.
    close(g.toPdfRect(client(140, 110, 20, 10)), {
      x: 20,
      y: 565,
      width: 10,
      height: 5,
    })
  })

  it('maps PDF → CSS and round-trips', async () => {
    const g = createPageGeometry(1, element, element, await realViewport(0))
    const css = g.toCssRect({ x: 20, y: 565, width: 10, height: 5 })
    close(css, { left: 40, top: 60, width: 20, height: 10 })
    const back = g.toPdfRect(
      client(100 + css.left, 50 + css.top, css.width, css.height),
    )
    close(back, { x: 20, y: 565, width: 10, height: 5 })
  })

  it.each([90, 180, 270])('round-trips at rotation %d', async (rotation) => {
    const g = createPageGeometry(
      1,
      element,
      element,
      await realViewport(rotation),
    )
    const rect = { x: 30, y: 100, width: 50, height: 20 }
    const css = g.toCssRect(rect)
    expect(css.width).toBeGreaterThan(0)
    expect(css.height).toBeGreaterThan(0)
    // Rotating by 90 or 270 swaps width and height on screen.
    if (rotation % 180 === 90) {
      close(css, { width: 40, height: 100 })
    } else {
      close(css, { width: 100, height: 40 })
    }
    close(
      g.toPdfRect(client(100 + css.left, 50 + css.top, css.width, css.height)),
      rect,
    )
  })

  it('respects a media box that does not start at the origin', async () => {
    const g = createPageGeometry(
      1,
      element,
      element,
      await realViewport(0, [50, 50, 450, 650]),
    )
    // Top-left pixel of the page is PDF (50, 650).
    close(g.toPdfRect(client(100, 50, 2, 2)), {
      x: 50,
      y: 649,
      width: 1,
      height: 1,
    })
    close(g.toCssRect({ x: 50, y: 649, width: 1, height: 1 }), {
      left: 0,
      top: 0,
      width: 2,
      height: 2,
    })
  })

  it('clamps a drag that leaves the page to the media box', async () => {
    const g = createPageGeometry(1, element, element, await realViewport(0))
    // Starts 30 px left of and above the page, ends inside it.
    close(g.toPdfRect(client(70, 20, 70, 70)), {
      x: 0,
      y: 580,
      width: 20,
      height: 20,
    })
  })
})

describe('clampToViewBox', () => {
  it('intersects with the box and collapses rects fully outside', () => {
    expect(
      clampToViewBox(
        { x: -10, y: -10, width: 30, height: 30 },
        [0, 0, 100, 100],
      ),
    ).toEqual({ x: 0, y: 0, width: 20, height: 20 })
    expect(
      clampToViewBox({ x: 200, y: 200, width: 5, height: 5 }, [0, 0, 100, 100]),
    ).toEqual({ x: 100, y: 100, width: 0, height: 0 })
  })
})
