/**
 * App-driven text selection for pens. On iPadOS an Apple Pencil drag over
 * text pans the page and native selection needs a long press, so a pen drag
 * over a text layer is turned into a DOM Range here: from the caret under the
 * starting point to the caret under the current one. DOM-aware but
 * framework-free.
 */

export interface CaretPoint {
  node: Node
  offset: number
}

export interface Point {
  x: number
  y: number
}

/** Movement (CSS px) below which a pen gesture is a tap, not a drag. */
export const PEN_TAP_THRESHOLD_PX = 4

export type CaretLookup = (x: number, y: number) => CaretPoint | null

interface CaretApis {
  caretRangeFromPoint?: Document['caretRangeFromPoint']
  caretPositionFromPoint?: Document['caretPositionFromPoint']
}

/**
 * Returns a function mapping a client point to the caret under it. Uses
 * `caretRangeFromPoint` (WebKit, Chromium) and falls back to the standard
 * `caretPositionFromPoint`. Throws when the browser has neither: pen
 * selection cannot work there and must not fail silently.
 */
export function caretLookup(doc: Document): CaretLookup {
  const apis: CaretApis = doc
  if (typeof apis.caretRangeFromPoint === 'function') {
    return (x, y) => {
      const range = apis.caretRangeFromPoint!.call(doc, x, y)
      return range
        ? { node: range.startContainer, offset: range.startOffset }
        : null
    }
  }
  if (typeof apis.caretPositionFromPoint === 'function') {
    return (x, y) => {
      const position = apis.caretPositionFromPoint!.call(doc, x, y)
      return position
        ? { node: position.offsetNode, offset: position.offset }
        : null
    }
  }
  throw new Error(
    'Pen selection is unavailable: this browser supports neither caretRangeFromPoint nor caretPositionFromPoint',
  )
}

/** A client-space rectangle, as `getBoundingClientRect()` returns it. */
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** Client rectangles of a text node, as the pen lookup needs them. */
export interface TextMeasure {
  /** The node's glyph box, or null when it shows nothing. */
  box: (node: Text) => Box | null
  /** One rectangle per character of the node, in order. */
  chars: (node: Text) => Box[]
}

/**
 * How far past a span's glyph box (as a fraction of its line's thickness,
 * the box's extent across the text) a pen point still lands on that span.
 * Across the text it bridges the gap between two lines; along it, the gap
 * between two spans of a line. A point farther from every span lands on
 * none. Both follow the span's direction, so rotated text gets the same
 * reach as upright text.
 */
export const LINE_REACH = 0.6
export const SPAN_REACH = 1.5
/** CSS px of slack when checking a native caret against its span's box. */
const NATIVE_SLACK_PX = 2

/**
 * Measures with Ranges: a Range's client rectangles follow the span's CSS
 * transforms (pdf.js's scaleX), unlike the caret lookup's local point.
 */
export const domTextMeasure: TextMeasure = {
  box(node) {
    const range = node.ownerDocument.createRange()
    range.selectNodeContents(node)
    return union(Array.from(range.getClientRects()))
  },
  chars(node) {
    const range = node.ownerDocument.createRange()
    const rects: Box[] = []
    for (let i = 0; i < node.data.length; i++) {
      range.setStart(node, i)
      range.setEnd(node, i + 1)
      rects.push(range.getBoundingClientRect())
    }
    return rects
  },
}

function union(rects: readonly Box[]): Box | null {
  const visible = rects.filter((r) => r.right > r.left && r.bottom > r.top)
  if (visible.length === 0) return null
  return {
    left: Math.min(...visible.map((r) => r.left)),
    top: Math.min(...visible.map((r) => r.top)),
    right: Math.max(...visible.map((r) => r.right)),
    bottom: Math.max(...visible.map((r) => r.bottom)),
  }
}

function distanceTo(box: Box, p: Point) {
  return {
    dx: Math.max(box.left - p.x, 0, p.x - box.right),
    dy: Math.max(box.top - p.y, 0, p.y - box.bottom),
  }
}

interface TextBox {
  node: Text
  box: Box
  chars: Box[] | null
}

/**
 * Distance from a span to `p` along its text and across it, and the
 * span's thickness across it. A span runs along its box's longer side:
 * pdf.js makes one span per run of text on one line, so a span is at least
 * as long as it is thick unless it holds a single narrow character.
 */
function reach(box: Box, p: Point) {
  const { dx, dy } = distanceTo(box, p)
  const width = box.right - box.left
  const height = box.bottom - box.top
  return width >= height
    ? { along: dx, across: dy, thickness: height }
    : { along: dy, across: dx, thickness: width }
}

function translate(r: Box, x: number, y: number): Box {
  return {
    left: r.left + x,
    right: r.right + x,
    top: r.top + y,
    bottom: r.bottom + y,
  }
}

/**
 * A caret lookup for pen gestures that lands on the text the pen is over,
 * or near it. Since the text layer sizes each span to its printed glyphs
 * (as pdf.js intends, see PdfPage.css), lines and spans have gaps between
 * them where the browser's caret lookup finds no text, and each span
 * carries a scale transform; before, the spans were taller than their lines
 * and overlapped, so the pen always had text under it.
 *
 * The browser's caret (`native`) is used when it lies in a span whose glyph
 * box holds the point. Otherwise the point snaps to the nearest span within
 * reach (`LINE_REACH`, `SPAN_REACH`) and to the character boundary nearest
 * to it along that span's text, measured from the characters' rectangles.
 * Span boxes are measured once per gesture (again while the layer is still
 * empty, as a page that just came on screen draws its text a moment later);
 * every measurement is kept in the layer's position at the first one, so a
 * scroll during the gesture does not stale them.
 */
export function snappingCaretLookup(
  textLayer: Element,
  native: CaretLookup | null,
  measure: TextMeasure = domTextMeasure,
): CaretLookup {
  let boxes: TextBox[] | null = null
  let origin: Box | null = null

  function measureLayer(): TextBox[] {
    const doc = textLayer.ownerDocument
    const walker = doc.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT)
    const found: TextBox[] = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const node = n as Text
      if (node.data.trim().length === 0) continue
      const box = measure.box(node)
      if (box) found.push({ node, box, chars: null })
    }
    return found
  }

  return (x, y) => {
    if (!boxes || !origin || boxes.length === 0) {
      origin = textLayer.getBoundingClientRect()
      boxes = measureLayer()
    }
    // How far the layer moved since the boxes were measured; the point and
    // any later measurement are taken back by that much.
    const now = textLayer.getBoundingClientRect()
    const shiftX = now.left - origin.left
    const shiftY = now.top - origin.top
    const p = { x: x - shiftX, y: y - shiftY }

    const caret = native?.(x, y) ?? null
    if (caret) {
      const hit = boxes.find((b) => b.node === caret.node)
      if (hit) {
        const { dx, dy } = distanceTo(hit.box, p)
        if (dx <= NATIVE_SLACK_PX && dy <= NATIVE_SLACK_PX) return caret
      }
    }

    let best: TextBox | null = null
    let bestScore = Infinity
    for (const b of boxes) {
      const { along, across, thickness } = reach(b.box, p)
      if (across > thickness * LINE_REACH || along > thickness * SPAN_REACH) {
        continue
      }
      // Staying on the line the pen is on beats a closer span on the next.
      const score = Math.hypot(along, across * 3)
      if (score < bestScore) {
        best = b
        bestScore = score
      }
    }
    if (!best) return null
    best.chars ??= measure
      .chars(best.node)
      .map((r) => translate(r, -shiftX, -shiftY))
    const offset = nearestBoundary(best.chars, p)
    return { node: best.node, offset: outsideSurrogatePair(best.node, offset) }
  }
}

/**
 * Moves an offset that falls between the two halves of a character outside
 * the Basic Multilingual Plane (a math letter such as 𝑥) to before it.
 */
function outsideSurrogatePair(node: Text, offset: number): number {
  const before = node.data.charCodeAt(offset - 1)
  const after = node.data.charCodeAt(offset)
  const high = before >= 0xd800 && before <= 0xdbff
  const low = after >= 0xdc00 && after <= 0xdfff
  return high && low ? offset - 1 : offset
}

/** Characters whose center lies before `p` along the span's text. */
function nearestBoundary(chars: readonly Box[], p: Point): number {
  const centers = chars.map((r) => ({
    x: (r.left + r.right) / 2,
    y: (r.top + r.bottom) / 2,
  }))
  if (centers.length === 0) return 0
  // Direction of the text: first to last character, rightward for one.
  const first = centers[0]
  const last = centers[centers.length - 1]
  let ux = last.x - first.x
  let uy = last.y - first.y
  const length = Math.hypot(ux, uy)
  if (length === 0) {
    ux = 1
    uy = 0
  } else {
    ux /= length
    uy /= length
  }
  const along = (q: Point) => q.x * ux + q.y * uy
  const at = along(p)
  return centers.filter((c) => along(c) < at).length
}

/** True once the pointer has moved far enough from `start` to be a drag. */
export function isDrag(
  start: Point,
  current: Point,
  threshold = PEN_TAP_THRESHOLD_PX,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold
}

/** A forward Range between two carets, whichever comes first in the DOM. */
export function orderedRange(doc: Document, a: CaretPoint, b: CaretPoint) {
  const range = doc.createRange()
  range.setStart(a.node, a.offset)
  range.setEnd(a.node, a.offset)
  if (range.comparePoint(b.node, b.offset) < 0) range.setStart(b.node, b.offset)
  else range.setEnd(b.node, b.offset)
  return range
}

/**
 * One pen gesture over a text layer. Carets are accepted only inside text
 * nodes of the layer: a point over a gap between spans (or over pdf.js's
 * page-sized `endOfContent` box) keeps the last good end point instead of
 * jumping to the layer's edge, and a drag that starts in a gap anchors on
 * the first text it reaches.
 */
export class PenSelection {
  private readonly textLayer: Element
  private readonly lookup: CaretLookup
  private readonly startPoint: Point
  private anchor: CaretPoint | null
  private focus: CaretPoint | null = null
  private dragging = false

  constructor(textLayer: Element, start: Point, lookup: CaretLookup) {
    this.textLayer = textLayer
    this.lookup = lookup
    this.startPoint = start
    this.anchor = this.caretAt(start)
  }

  /**
   * Extends the gesture to `point`. Returns the range to show, or null while
   * the gesture is still a tap or no text has been reached.
   */
  move(point: Point): Range | null {
    if (!this.dragging && !isDrag(this.startPoint, point)) return null
    this.dragging = true
    const caret = this.caretAt(point)
    if (caret && !this.anchor) this.anchor = caret
    else if (caret) this.focus = caret
    return this.range()
  }

  /** The current range, or null for a tap or a gesture that found no text. */
  range(): Range | null {
    if (!this.dragging || !this.anchor || !this.focus) return null
    const doc = this.textLayer.ownerDocument
    const range = orderedRange(doc, this.anchor, this.focus)
    return range.collapsed ? null : range
  }

  private caretAt(point: Point): CaretPoint | null {
    const caret = this.lookup(point.x, point.y)
    if (!caret) return null
    if (caret.node.nodeType !== Node.TEXT_NODE) return null
    if (!this.textLayer.contains(caret.node)) return null
    return caret
  }
}

/**
 * True when any touch comes from a stylus. WebKit sets the non-standard
 * `touchType: 'stylus'` on Apple Pencil touches; browsers without it return
 * false and rely on the pen's pointer events instead.
 */
export function hasStylusTouch(touches: ArrayLike<Touch>): boolean {
  return Array.from(touches).some(
    (t) => (t as Touch & { touchType?: string }).touchType === 'stylus',
  )
}
