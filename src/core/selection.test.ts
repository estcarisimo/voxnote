// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { PdfRect } from './annotations'
import {
  normalizeQuote,
  quoteFromRange,
  textAnchorFromRange,
  textOffsetsInLayer,
  type RectLike,
} from './selection'

function layerWithSpans(texts: string[]): HTMLDivElement {
  const layer = document.createElement('div')
  layer.className = 'textLayer'
  for (const t of texts) {
    const span = document.createElement('span')
    span.textContent = t
    layer.appendChild(span)
    layer.appendChild(document.createElement('br'))
  }
  document.body.appendChild(layer)
  return layer
}

const clientRect = (
  left: number,
  top: number,
  w: number,
  h: number,
): RectLike => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
  width: w,
  height: h,
})

/** Fake page geometry: 100 px tall page, 1 px = 1 pt, y flipped. */
const toPdfRect = (r: RectLike): PdfRect => ({
  x: r.left,
  y: 100 - r.bottom,
  width: r.width,
  height: r.height,
})

describe('normalizeQuote', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeQuote('  Emden\nR.   Gansner ')).toBe('Emden R. Gansner')
  })
})

describe('quoteFromRange', () => {
  it('keeps a break between lines and respects partial end points', () => {
    const layer = layerWithSpans(['Emden R. Gansner', 'erg@graphviz.com'])
    const spans = layer.querySelectorAll('span')
    const range = document.createRange()
    range.setStart(spans[0].firstChild as Text, 6)
    range.setEnd(spans[1].firstChild as Text, 3)
    expect(quoteFromRange(range)).toBe('R. Gansner\nerg')
    expect(range.toString()).toBe('R. Gansnererg') // the reason this exists
  })
})

describe('textOffsetsInLayer', () => {
  it('counts characters across preceding spans', () => {
    const layer = layerWithSpans(['Cgraph Tutorial', 'Stephen C. North'])
    const second = layer.querySelectorAll('span')[1].firstChild as Text
    const range = document.createRange()
    range.setStart(second, 8)
    range.setEnd(second, 16)
    expect(textOffsetsInLayer(range, layer)).toEqual({ start: 23, end: 31 })
  })

  it('resolves element boundaries', () => {
    const layer = layerWithSpans(['abc', 'def'])
    const range = document.createRange()
    range.setStart(layer, 0) // before first span
    range.setEnd(layer, layer.childNodes.length) // after everything
    expect(textOffsetsInLayer(range, layer)).toEqual({ start: 0, end: 6 })
  })
})

describe('textAnchorFromRange', () => {
  it('builds a text anchor with quote, merged rects and offsets', () => {
    const layer = layerWithSpans(['Emden R. Gansner', 'erg@graphviz.com'])
    const spans = layer.querySelectorAll('span')
    const range = document.createRange()
    range.setStart(spans[0].firstChild as Text, 0)
    range.setEnd(spans[1].firstChild as Text, 3)
    const anchor = textAnchorFromRange(range, {
      page: 1,
      textLayer: layer,
      clientRects: [
        clientRect(10, 10, 50, 10),
        clientRect(60, 10, 30, 10),
        clientRect(10, 22, 20, 10),
        clientRect(0, 0, 0, 0),
      ],
      toPdfRect,
    })
    expect(anchor).toEqual({
      type: 'text',
      page: 1,
      quote: 'Emden R. Gansner erg',
      rects: [
        { x: 10, y: 80, width: 80, height: 10 },
        { x: 10, y: 68, width: 20, height: 10 },
      ],
      textOffsets: { start: 0, end: 19 },
    })
  })

  it('returns null for collapsed ranges, ranges outside the layer, or no rects', () => {
    const layer = layerWithSpans(['abc'])
    const outside = document.createElement('p')
    outside.textContent = 'elsewhere'
    document.body.appendChild(outside)
    const text = layer.querySelector('span')!.firstChild as Text
    const base = { page: 1, textLayer: layer, toPdfRect }

    const collapsed = document.createRange()
    collapsed.setStart(text, 1)
    collapsed.setEnd(text, 1)
    expect(
      textAnchorFromRange(collapsed, {
        ...base,
        clientRects: [clientRect(0, 0, 1, 1)],
      }),
    ).toBeNull()

    const away = document.createRange()
    away.selectNodeContents(outside)
    expect(
      textAnchorFromRange(away, {
        ...base,
        clientRects: [clientRect(0, 0, 1, 1)],
      }),
    ).toBeNull()

    const noRects = document.createRange()
    noRects.selectNodeContents(text)
    expect(
      textAnchorFromRange(noRects, { ...base, clientRects: [] }),
    ).toBeNull()
  })
})
