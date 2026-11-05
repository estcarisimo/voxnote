/**
 * Bridges DOM selections and BlockTextAnchors over a rendered Markdown
 * document. DOM-aware but framework-free. The renderer marks every top-level
 * block element with `data-block="<ordinal>"`; offsets count the characters
 * of the block element's text nodes, which equal `blockPlainText` of the
 * block by the renderer's contract.
 */
import type { BlockTextAnchor } from './annotations'
import { normalizeQuote, quoteFromRange, textOffsetsInLayer } from './selection'

export const BLOCK_ATTRIBUTE = 'data-block'

/** The top-level block element that contains `node`, or null. */
export function blockElementOf(node: Node, root: Element): Element | null {
  const element =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  const block = element?.closest(`[${BLOCK_ATTRIBUTE}]`) ?? null
  if (!block || !root.contains(block)) return null
  return block
}

/** The ordinal in a block element's `data-block`; throws on a bad value. */
export function blockOrdinal(block: Element): number {
  const raw = block.getAttribute(BLOCK_ATTRIBUTE)
  const ordinal = Number(raw)
  if (!Number.isInteger(ordinal) || ordinal < 1) {
    throw new Error(`Block element has no valid ${BLOCK_ATTRIBUTE}: "${raw}"`)
  }
  return ordinal
}

/**
 * Builds a BlockTextAnchor for `range`, or returns null when the range is
 * collapsed, outside `root`, spans two top-level blocks (like a selection
 * across two PDF pages, it gets no toolbar), or selects only whitespace.
 */
export function blockTextAnchorFromRange(
  range: Range,
  root: Element,
): BlockTextAnchor | null {
  if (range.collapsed) return null
  const startBlock = blockElementOf(range.startContainer, root)
  const endBlock = blockElementOf(range.endContainer, root)
  if (!startBlock || startBlock !== endBlock) return null

  const quote = normalizeQuote(quoteFromRange(range))
  if (quote.length === 0) return null

  const offsets = textOffsetsInLayer(range, startBlock)
  if (!offsets || offsets.end <= offsets.start) return null

  return {
    type: 'block-text',
    page: blockOrdinal(startBlock),
    quote,
    start: offsets.start,
    end: offsets.end,
  }
}

/**
 * The DOM range for an anchor inside its block element. Throws when the
 * offsets fall outside the block's text: the stored anchor and the rendered
 * document disagree, and a mark in the wrong place would mislead.
 */
export function rangeForBlockAnchor(
  block: Element,
  anchor: Pick<BlockTextAnchor, 'start' | 'end'>,
): Range {
  const doc = block.ownerDocument
  const range = doc.createRange()
  const start = boundaryAt(block, anchor.start)
  const end = boundaryAt(block, anchor.end)
  if (!start || !end) {
    throw new Error(
      `Anchor offsets ${anchor.start}–${anchor.end} exceed the block's text (${block.textContent?.length ?? 0} characters)`,
    )
  }
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  return range
}

/**
 * The text node and offset `offset` characters into the block's text. An
 * offset at the very end lands at the end of the last text node; a block
 * with no text nodes resolves nothing.
 */
function boundaryAt(
  block: Element,
  offset: number,
): { node: Node; offset: number } | null {
  const walker = block.ownerDocument.createTreeWalker(
    block,
    NodeFilter.SHOW_TEXT,
  )
  let remaining = offset
  let last: Node | null = null
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0
    if (remaining <= length) return { node, offset: remaining }
    remaining -= length
    last = node
  }
  if (remaining === 0 && last) {
    return { node: last, offset: last.textContent?.length ?? 0 }
  }
  return null
}
