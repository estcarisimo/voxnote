/**
 * Turns a DOM selection over a pdf.js text layer into a TextAnchor. DOM-aware
 * but framework-free; geometry conversion is injected so this module knows
 * nothing about pdf.js viewports.
 */
import { mergeLineRects, type PdfRect, type TextAnchor } from './annotations'

export interface RectLike {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface TextAnchorSource {
  page: number
  /** The page's text layer element; the range must lie inside it. */
  textLayer: Element
  /** Client rectangles of the selection, e.g. `range.getClientRects()`. */
  clientRects: readonly RectLike[]
  /** Converts a client rectangle into PDF user space for this page. */
  toPdfRect: (clientRect: RectLike) => PdfRect
}

/** Collapses runs of whitespace (pdf.js inserts line breaks between spans). */
export function normalizeQuote(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Builds a TextAnchor for `range`, or returns null when the range is
 * collapsed, outside the text layer, or has no visible rectangles.
 */
export function textAnchorFromRange(
  range: Range,
  source: TextAnchorSource,
): TextAnchor | null {
  if (range.collapsed) return null
  if (!source.textLayer.contains(range.commonAncestorContainer)) return null

  const quote = normalizeQuote(quoteFromRange(range))
  if (quote.length === 0) return null

  const rects = mergeLineRects(
    source.clientRects
      .filter((r) => r.width > 0 && r.height > 0)
      .map(source.toPdfRect),
  )
  if (rects.length === 0) return null

  const anchor: TextAnchor = {
    type: 'text',
    page: source.page,
    quote,
    rects,
  }
  const offsets = textOffsetsInLayer(range, source.textLayer)
  if (offsets) anchor.textOffsets = offsets
  return anchor
}

/**
 * Text of the range as a reader sees it: text nodes in document order, with a
 * line break wherever a `<br>` sits between them. `Range.toString()` drops
 * `<br>` and would glue the last word of a line to the first of the next.
 */
export function quoteFromRange(range: Range): string {
  const root = range.commonAncestorContainer
  const doc = root.ownerDocument ?? (root as Document)
  if (root.nodeType === Node.TEXT_NODE) {
    return (root.textContent ?? '').slice(range.startOffset, range.endOffset)
  }
  const walker = doc.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  )
  let text = ''
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!range.intersectsNode(n)) continue
    if (n.nodeType === Node.ELEMENT_NODE) {
      if ((n as Element).tagName === 'BR') text += '\n'
      continue
    }
    let value = n.textContent ?? ''
    if (n === range.endContainer) value = value.slice(0, range.endOffset)
    if (n === range.startContainer) value = value.slice(range.startOffset)
    text += value
  }
  return text
}

/**
 * Character offsets of the range within the concatenated text content of the
 * layer. Returns null when the range endpoints are not inside text nodes.
 */
export function textOffsetsInLayer(
  range: Range,
  textLayer: Element,
): { start: number; end: number } | null {
  const start = offsetOfBoundary(
    range.startContainer,
    range.startOffset,
    textLayer,
  )
  const end = offsetOfBoundary(range.endContainer, range.endOffset, textLayer)
  if (start === null || end === null || end < start) return null
  return { start, end }
}

function offsetOfBoundary(
  container: Node,
  offset: number,
  textLayer: Element,
): number | null {
  const doc = textLayer.ownerDocument
  if (!doc) return null
  if (container.nodeType === Node.TEXT_NODE) {
    return charsBefore(container, textLayer) + offset
  }
  // Element boundary: resolve to the child at `offset`, or to the end.
  const child = container.childNodes[offset]
  if (child) {
    return charsBefore(firstTextNodeIn(child, doc) ?? child, textLayer)
  }
  return charsBefore(null, textLayer)
}

function firstTextNodeIn(node: Node, doc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return node
  const walker = doc.createTreeWalker(node, NodeFilter.SHOW_TEXT)
  return walker.nextNode()
}

/** Characters in text nodes of the layer that precede `node` (all, if null). */
function charsBefore(node: Node | null, textLayer: Element): number {
  const doc = textLayer.ownerDocument
  if (!doc) return 0
  const walker = doc.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT)
  let count = 0
  let current = walker.nextNode()
  while (current && current !== node) {
    count += current.textContent?.length ?? 0
    current = walker.nextNode()
  }
  return count
}
