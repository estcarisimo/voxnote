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
