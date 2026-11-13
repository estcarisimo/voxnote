// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  caretLookup,
  hasStylusTouch,
  isDrag,
  orderedRange,
  PenSelection,
  snappingCaretLookup,
  textRunsVertically,
  type Box,
  type CaretLookup,
  type CaretPoint,
  type TextMeasure,
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

describe('snappingCaretLookup', () => {
  /**
   * Spans sized to their glyphs, as pdf.js lays them out: rows 10 px tall
   * every 14 px (a 4 px gap between lines), 10 px per character, starting
   * at x = 100 for the first span and x = 0 for the others.
   */
  function glyphGrid(layer: Element, startX: (row: number) => number) {
    const row = (node: Text) =>
      Array.from(layer.children).findIndex((s) => s.firstChild === node)
    const char = (node: Text, i: number): Box => {
      const r = row(node)
      const left = startX(r) + i * 10
      return { left, right: left + 10, top: r * 14, bottom: r * 14 + 10 }
    }
    const measure: TextMeasure = {
      box: (node) => {
        const first = char(node, 0)
        return { ...first, right: first.left + node.data.length * 10 }
      },
      chars: (node) => Array.from(node.data, (_, i) => char(node, i)),
    }
    return measure
  }
  const leftAligned = () => 0

  it('keeps the browser caret when it lies in the span under the pen', () => {
    const layer = layerWithSpans(['alpha', 'beta'])
    const native: CaretLookup = () => ({ node: textOf(layer, 1), offset: 2 })
    const lookup = snappingCaretLookup(
      layer,
      native,
      glyphGrid(layer, leftAligned),
    )
    expect(lookup(21, 18)).toEqual({ node: textOf(layer, 1), offset: 2 })
  })

  it('snaps a point in the gap between two lines to the nearer line', () => {
    const layer = layerWithSpans(['alpha', 'beta'])
    const lookup = snappingCaretLookup(
      layer,
      () => null,
      glyphGrid(layer, leftAligned),
    )
    // y = 11 is 1 px below "alpha" and 3 px above "beta".
    expect(lookup(26, 11)).toEqual({ node: textOf(layer, 0), offset: 3 })
    expect(lookup(26, 13)).toEqual({ node: textOf(layer, 1), offset: 3 })
  })

  it('overrides a browser caret that landed on text away from the pen', () => {
    const layer = layerWithSpans(['alpha', 'beta', 'gamma'])
    // WebKit can answer a point between spans with a caret anywhere.
    const native: CaretLookup = () => ({ node: textOf(layer, 2), offset: 0 })
    const lookup = snappingCaretLookup(
      layer,
      native,
      glyphGrid(layer, leftAligned),
    )
    expect(lookup(14, 5)).toEqual({ node: textOf(layer, 0), offset: 1 })
  })

  it('finds nothing far from every span', () => {
    const layer = layerWithSpans(['alpha'])
    const lookup = snappingCaretLookup(
      layer,
      () => null,
      glyphGrid(layer, leftAligned),
    )
    expect(lookup(20, 40)).toBeNull()
    expect(lookup(200, 5)).toBeNull()
  })

  it('reaches a span from just beside it on its line', () => {
    const layer = layerWithSpans(['alpha', 'beta'])
    // "alpha" starts at x = 100: a pen 8 px before or 5 px after it.
    const lookup = snappingCaretLookup(
      layer,
      () => null,
      glyphGrid(layer, (row) => (row === 0 ? 100 : 0)),
    )
    expect(lookup(92, 5)).toEqual({ node: textOf(layer, 0), offset: 0 })
    expect(lookup(155, 5)).toEqual({ node: textOf(layer, 0), offset: 5 })
  })

  it('ignores a whitespace-only span', () => {
    const layer = layerWithSpans(['alpha', '   '])
    const lookup = snappingCaretLookup(
      layer,
      () => null,
      glyphGrid(layer, leftAligned),
    )
    expect(lookup(20, 16)).toEqual({ node: textOf(layer, 0), offset: 2 })
  })

  /** The grid placed where the layer is now, as a real measurement is. */
  function movingGrid(layer: Element): TextMeasure {
    const grid = glyphGrid(layer, leftAligned)
    const at = () => layer.getBoundingClientRect()
    const shift = (r: Box): Box => ({
      left: r.left + at().left,
      right: r.right + at().left,
      top: r.top + at().top,
      bottom: r.bottom + at().top,
    })
    return {
      box: (node) => {
        const b = grid.box(node)
        return b && shift(b)
      },
      chars: (node) => grid.chars(node).map(shift),
    }
  }

  it('follows the layer when the page scrolls during a gesture', () => {
    const layer = layerWithSpans(['alpha', 'beta'])
    let top = 0
    layer.getBoundingClientRect = () => new DOMRect(0, top, 600, 800)
    const lookup = snappingCaretLookup(layer, () => null, movingGrid(layer))
    expect(lookup(26, 5)).toEqual({ node: textOf(layer, 0), offset: 3 })
    top = -14 // scrolled up by one line: "beta" is now where "alpha" was
    expect(lookup(26, 5)).toEqual({ node: textOf(layer, 1), offset: 3 })
  })

  it('measures characters right after a scroll that came first', () => {
    const layer = layerWithSpans(['alpha', 'beta'])
    let left = 0
    layer.getBoundingClientRect = () => new DOMRect(left, 0, 600, 800)
    const lookup = snappingCaretLookup(layer, () => null, movingGrid(layer))
    expect(lookup(5, 18)).toEqual({ node: textOf(layer, 1), offset: 0 })
    left = -30 // scrolled before the pen reaches "alpha"
    // Character 2 of "alpha" spans 20 to 30 in the layer: -10 to 0 now.
    expect(lookup(-6, 5)).toEqual({ node: textOf(layer, 0), offset: 2 })
  })

  it('measures again while the layer is still empty', () => {
    const layer = layerWithSpans([])
    const lookup = snappingCaretLookup(
      layer,
      () => null,
      glyphGrid(layer, leftAligned),
    )
    expect(lookup(26, 5)).toBeNull()
    const span = document.createElement('span')
    span.textContent = 'alpha'
    layer.appendChild(span) // the text layer finished drawing
    expect(lookup(26, 5)).toEqual({ node: textOf(layer, 0), offset: 3 })
  })

  it('keeps a character outside the BMP whole', () => {
    const layer = layerWithSpans(['a\u{1d465}b']) // a, math italic x, b
    const lookup = snappingCaretLookup(
      layer,
      () => null,
      glyphGrid(layer, leftAligned),
    )
    // Four UTF-16 units at 10 px each; the pen is between the two halves.
    expect(lookup(19, 5)).toEqual({ node: textOf(layer, 0), offset: 1 })
  })

  it('measures offsets along vertical text', () => {
    const layer = layerWithSpans(['abc'])
    layer.setAttribute('data-main-rotation', '270')
    const measure: TextMeasure = {
      box: () => ({ left: 0, right: 10, top: 0, bottom: 30 }),
      chars: (node) =>
        Array.from(node.data, (_, i) => ({
          left: 0,
          right: 10,
          top: i * 10,
          bottom: i * 10 + 10,
        })),
    }
    const lookup = snappingCaretLookup(layer, () => null, measure)
    expect(lookup(5, 17)).toEqual({ node: textOf(layer, 0), offset: 2 })
  })

  it("gives vertical text a line's reach, not its length", () => {
    // A line 12 px thick running down 300 px, as on a page rotated 90°.
    const layer = layerWithSpans(['x'.repeat(30)])
    layer.setAttribute('data-main-rotation', '90')
    const measure: TextMeasure = {
      box: () => ({ left: 0, right: 12, top: 0, bottom: 300 }),
      chars: (node) =>
        Array.from(node.data, (_, i) => ({
          left: 0,
          right: 12,
          top: i * 10,
          bottom: i * 10 + 10,
        })),
    }
    const lookup = snappingCaretLookup(layer, () => null, measure)
    // 6 px beside the line (within 0.6 of 12 px) lands on it.
    expect(lookup(18, 175)).toEqual({ node: textOf(layer, 0), offset: 17 })
    // 400 px beside it (across many lines, or out in the margin) does not.
    expect(lookup(412, 175)).toBeNull()
  })
  it('leaves a diagonal span to the browser caret', () => {
    // Body lines plus a 45° "DRAFT" whose upright box covers them all.
    const layer = layerWithSpans(['alpha', 'beta', 'DRAFT'])
    const draft = layer.children[2] as HTMLElement
    draft.style.setProperty('--rotate', '-45deg')
    const grid = glyphGrid(layer, leftAligned)
    const measure: TextMeasure = {
      box: (node) =>
        node === draft.firstChild
          ? { left: 0, right: 300, top: 0, bottom: 300 }
          : grid.box(node),
      chars: grid.chars,
    }
    const lookup = snappingCaretLookup(layer, () => null, measure)
    // In the gap 1 px below "alpha": the line, not the watermark.
    expect(lookup(26, 11)).toEqual({ node: textOf(layer, 0), offset: 3 })
    // The browser's caret on the watermark itself is still taken.
    const onDraft = { node: textOf(layer, 2), offset: 1 }
    expect(snappingCaretLookup(layer, () => onDraft, measure)(150, 150)).toBe(
      onDraft,
    )
  })

  it('reaches a one-letter span by its line height', () => {
    const layer = layerWithSpans(['i'])
    const measure: TextMeasure = {
      box: () => ({ left: 0, right: 4, top: 0, bottom: 10 }),
      chars: () => [{ left: 0, right: 4, top: 0, bottom: 10 }],
    }
    const lookup = snappingCaretLookup(layer, () => null, measure)
    expect(lookup(7, 5)).toEqual({ node: textOf(layer, 0), offset: 1 })
  })

  it('measures again when more of the layer has been drawn', () => {
    const layer = layerWithSpans(['alpha'])
    const lookup = snappingCaretLookup(
      layer,
      () => null,
      glyphGrid(layer, leftAligned),
    )
    expect(lookup(26, 18)).toBeNull()
    const span = document.createElement('span')
    span.textContent = 'beta'
    layer.appendChild(span) // pdf.js appends spans as the text streams in
    expect(lookup(26, 18)).toEqual({ node: textOf(layer, 1), offset: 3 })
  })
})

describe('textRunsVertically', () => {
  const span = (rotate?: string) => {
    const el = document.createElement('span')
    if (rotate) el.style.setProperty('--rotate', rotate)
    return el
  }
  const layer = (rotation?: string) => {
    const el = document.createElement('div')
    if (rotation) el.setAttribute('data-main-rotation', rotation)
    return el
  }

  it('reads the page rotation and the span rotation together', () => {
    expect(textRunsVertically(layer(), span())).toBe(false)
    expect(textRunsVertically(layer('90'), span())).toBe(true)
    expect(textRunsVertically(layer('180'), span())).toBe(false)
    expect(textRunsVertically(layer(), span('-90deg'))).toBe(true)
    expect(textRunsVertically(layer('90'), span('90deg'))).toBe(false)
  })

  it('returns null for text at any other angle', () => {
    expect(textRunsVertically(layer(), span('45deg'))).toBeNull()
    expect(textRunsVertically(layer('90'), span('-30deg'))).toBeNull()
  })
})
