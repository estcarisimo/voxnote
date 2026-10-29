// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  caretLookup,
  hasStylusTouch,
  isDrag,
  orderedRange,
  PenSelection,
  type CaretLookup,
  type CaretPoint,
} from './penSelection'

function layerWithSpans(texts: string[]): HTMLDivElement {
  const layer = document.createElement('div')
  layer.className = 'textLayer'
  for (const t of texts) {
    const span = document.createElement('span')
    span.textContent = t
    layer.appendChild(span)
  }
  document.body.appendChild(layer)
  return layer
}

const textOf = (layer: Element, i: number) => layer.children[i].firstChild!

/** One 10 px row per span, 10 px per character. */
function gridLookup(layer: Element): CaretLookup {
  return (px, py) => {
    const x = Math.floor(px / 10)
    const span = layer.children[Math.floor(py / 10)]
    if (!span?.firstChild) return null
    const text = span.firstChild
    return { node: text, offset: Math.min(x, text.textContent!.length) }
  }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('caretLookup', () => {
  it('prefers caretRangeFromPoint', () => {
    const layer = layerWithSpans(['hello'])
    const text = textOf(layer, 0)
    const doc = {
      caretRangeFromPoint: (x: number) => {
        const r = document.createRange()
        r.setStart(text, x)
        return r
      },
      caretPositionFromPoint: () => {
        throw new Error('fallback must not run')
      },
    } as unknown as Document
    expect(caretLookup(doc)(3, 0)).toEqual({ node: text, offset: 3 })
  })

  it('falls back to caretPositionFromPoint', () => {
    const layer = layerWithSpans(['hello'])
    const text = textOf(layer, 0)
    const doc = {
      caretPositionFromPoint: (x: number) => ({ offsetNode: text, offset: x }),
    } as unknown as Document
    expect(caretLookup(doc)(2, 0)).toEqual({ node: text, offset: 2 })
  })

  it('returns null when nothing is under the point', () => {
    const doc = { caretRangeFromPoint: () => null } as unknown as Document
    expect(caretLookup(doc)(0, 0)).toBeNull()
  })

  it('throws when the browser has neither API', () => {
    expect(() => caretLookup({} as Document)).toThrow(/caretRangeFromPoint/)
  })
})

describe('isDrag', () => {
  it('treats movement under the threshold as a tap', () => {
    expect(isDrag({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false)
    expect(isDrag({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(true)
    expect(isDrag({ x: 0, y: 0 }, { x: 5, y: 0 }, 10)).toBe(false)
  })
})

describe('orderedRange', () => {
  it('is forward whichever caret comes first', () => {
    const layer = layerWithSpans(['alpha', 'beta'])
    const a: CaretPoint = { node: textOf(layer, 0), offset: 1 }
    const b: CaretPoint = { node: textOf(layer, 1), offset: 2 }
    for (const range of [
      orderedRange(document, a, b),
      orderedRange(document, b, a),
    ]) {
      expect(range.collapsed).toBe(false)
      expect(range.toString()).toBe('lphabe')
    }
  })

  it('orders carets within one text node', () => {
    const layer = layerWithSpans(['alpha'])
    const t = textOf(layer, 0)
    const range = orderedRange(
      document,
      { node: t, offset: 4 },
      { node: t, offset: 1 },
    )
    expect(range.toString()).toBe('lph')
  })
})

describe('PenSelection', () => {
  it('selects from the start caret to the current one', () => {
    const layer = layerWithSpans(['alpha', 'beta'])
    const pen = new PenSelection(layer, { x: 10, y: 0 }, gridLookup(layer))
    expect(pen.move({ x: 30, y: 10 })?.toString()).toBe('lphabet')
    expect(pen.isDragging).toBe(true)
  })

  it('keeps the range forward when dragging backwards', () => {
    const layer = layerWithSpans(['alpha', 'beta'])
    const pen = new PenSelection(layer, { x: 20, y: 10 }, gridLookup(layer))
    expect(pen.move({ x: 0, y: 0 })?.toString()).toBe('alphabe')
  })

  it('returns no range for a tap', () => {
    const layer = layerWithSpans(['alpha'])
    const pen = new PenSelection(layer, { x: 10, y: 0 }, gridLookup(layer))
    expect(pen.move({ x: 12, y: 1 })).toBeNull()
    expect(pen.isDragging).toBe(false)
    expect(pen.range()).toBeNull()
  })

  it('keeps the last end point over a gap', () => {
    const layer = layerWithSpans(['alpha', 'beta'])
    const pen = new PenSelection(layer, { x: 0, y: 0 }, gridLookup(layer))
    pen.move({ x: 50, y: 0 })
    // Row 7 has no span: the lookup returns null.
    expect(pen.move({ x: 50, y: 70 })?.toString()).toBe('alpha')
  })

  it('ignores carets outside the text layer or in element nodes', () => {
    const layer = layerWithSpans(['alpha'])
    const outside = document.createElement('p')
    outside.textContent = 'outside'
    document.body.appendChild(outside)
    let next: CaretPoint | null = null
    const lookup: CaretLookup = (x) =>
      next ?? { node: textOf(layer, 0), offset: x / 10 }
    const pen = new PenSelection(layer, { x: 0, y: 0 }, lookup)
    pen.move({ x: 40, y: 0 })
    next = { node: outside.firstChild!, offset: 3 }
    expect(pen.move({ x: 200, y: 0 })?.toString()).toBe('alph')
    next = { node: layer, offset: 1 }
    expect(pen.move({ x: 300, y: 0 })?.toString()).toBe('alph')
  })

  it('anchors on the first text reached when starting in a gap', () => {
    const layer = layerWithSpans(['alpha', 'beta'])
    const pen = new PenSelection(layer, { x: 0, y: 90 }, gridLookup(layer))
    expect(pen.move({ x: 20, y: 0 })).toBeNull()
    expect(pen.move({ x: 20, y: 10 })?.toString()).toBe('phabe')
  })
})

describe('hasStylusTouch', () => {
  it('detects WebKit stylus touches', () => {
    const touch = (touchType?: string) => ({ touchType }) as unknown as Touch
    expect(hasStylusTouch([touch('direct'), touch('stylus')])).toBe(true)
    expect(hasStylusTouch([touch('direct'), touch()])).toBe(false)
    expect(hasStylusTouch([])).toBe(false)
  })
})
