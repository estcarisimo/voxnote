import { beforeEach, describe, expect, it } from 'vitest'
import {
  blockElementOf,
  blockOrdinal,
  blockTextAnchorFromRange,
  rangeForBlockAnchor,
} from './blockSelection'

let root: HTMLElement

beforeEach(() => {
  document.body.innerHTML = `
    <article id="root">
      <h1 data-block="1">Title</h1>
      <p data-block="2">A <em>para</em> with <code>code</code> here.</p>
      <ul data-block="3"><li>one</li><li>two</li></ul>
    </article>
    <p id="outside">elsewhere</p>`
  root = document.getElementById('root')!
})

function textNode(selector: string, index = 0): Text {
  const element = document.querySelector(selector)!
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  for (let i = 0; i < index; i++) node = walker.nextNode()
  if (!node) throw new Error(`No text node ${index} in ${selector}`)
  return node as Text
}

function rangeOf(
  start: Node,
  startOffset: number,
  end: Node,
  endOffset: number,
) {
  const range = document.createRange()
  range.setStart(start, startOffset)
  range.setEnd(end, endOffset)
  return range
}

describe('blockElementOf and blockOrdinal', () => {
  it('finds the top-level block of a node inside the root', () => {
    const em = document.querySelector('em')!
    expect(
      blockElementOf(em.firstChild!, root)?.getAttribute('data-block'),
    ).toBe('2')
    expect(blockElementOf(em, root)).toBe(
      document.querySelector('p[data-block]'),
    )
    expect(blockElementOf(document.getElementById('outside')!, root)).toBeNull()
    expect(blockOrdinal(document.querySelector('ul')!)).toBe(3)
  })

  it('throws on a block without a valid ordinal', () => {
    const bad = document.createElement('p')
    bad.setAttribute('data-block', 'x')
    expect(() => blockOrdinal(bad)).toThrow('data-block')
  })
})

describe('blockTextAnchorFromRange', () => {
  it('anchors a selection within one block by plain-text offsets', () => {
    // "A |para| with" → from inside <em> to the text after it.
    const range = rangeOf(textNode('em'), 0, textNode('p[data-block]', 2), 5)
    expect(blockTextAnchorFromRange(range, root)).toEqual({
      type: 'block-text',
      page: 2,
      quote: 'para with',
      start: 2,
      end: 11,
    })
  })

  it('normalizes whitespace in the quote but keeps raw offsets', () => {
    const range = rangeOf(textNode('ul'), 0, textNode('ul', 1), 3)
    expect(blockTextAnchorFromRange(range, root)).toEqual({
      type: 'block-text',
      page: 3,
      quote: 'onetwo',
      start: 0,
      end: 6,
    })
  })

  it('returns null for a collapsed range, a cross-block range or one outside the root', () => {
    const collapsed = rangeOf(textNode('h1'), 1, textNode('h1'), 1)
    expect(blockTextAnchorFromRange(collapsed, root)).toBeNull()
    const across = rangeOf(textNode('h1'), 0, textNode('em'), 2)
    expect(blockTextAnchorFromRange(across, root)).toBeNull()
    const outside = textNode('#outside')
    expect(
      blockTextAnchorFromRange(rangeOf(outside, 0, outside, 4), root),
    ).toBeNull()
  })

  it('returns null for whitespace only', () => {
    // The single space between "A" and <em>.
    const range = rangeOf(
      textNode('p[data-block]'),
      1,
      textNode('p[data-block]'),
      2,
    )
    expect(blockTextAnchorFromRange(range, root)).toBeNull()
  })
})

describe('rangeForBlockAnchor', () => {
  it('resolves offsets back to the same text, across inline elements', () => {
    const block = document.querySelector('p[data-block]')!
    const range = rangeForBlockAnchor(block, { start: 2, end: 11 })
    expect(range.toString()).toBe('para with')
    expect(rangeForBlockAnchor(block, { start: 0, end: 1 }).toString()).toBe(
      'A',
    )
    const whole = block.textContent!.length
    expect(
      rangeForBlockAnchor(block, { start: 0, end: whole }).toString(),
    ).toBe(block.textContent)
  })

  it('round-trips an anchor built from a range', () => {
    const block = document.querySelector('ul')!
    const original = rangeOf(textNode('ul'), 1, textNode('ul', 1), 2)
    const anchor = blockTextAnchorFromRange(original, root)!
    expect(rangeForBlockAnchor(block, anchor).toString()).toBe(
      original.toString(),
    )
  })

  it('throws when the offsets exceed the block text', () => {
    const block = document.querySelector('h1')!
    expect(() => rangeForBlockAnchor(block, { start: 0, end: 6 })).toThrow(
      'exceed the block',
    )
    const empty = document.createElement('hr')
    expect(() => rangeForBlockAnchor(empty, { start: 0, end: 1 })).toThrow()
  })
})
