import { describe, expect, it } from 'vitest'
import {
  ANNOTATION_SCHEMA_VERSION,
  createHighlight,
  isAnnotation,
  isAnchor,
  mergeLineRects,
  rectFromCorners,
  unionRects,
  type Annotation,
  type PdfRect,
} from './annotations'

const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
): PdfRect => ({
  x,
  y,
  width,
  height,
})

describe('createHighlight', () => {
  it('fills defaults and UTC timestamps', () => {
    const now = new Date('2026-10-29T12:34:56.000Z')
    const a = createHighlight(
      {
        documentId: 'doc',
        anchor: { type: 'region', page: 2, rect: rect(1, 2, 3, 4) },
      },
      now,
    )
    expect(a.schemaVersion).toBe(ANNOTATION_SCHEMA_VERSION)
    expect(a.kind).toBe('highlight')
    expect(a.visibility).toBe('private')
    expect(a.createdAt).toBe('2026-10-29T12:34:56.000Z')
    expect(a.updatedAt).toBe(a.createdAt)
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(isAnnotation(a)).toBe(true)
  })

  it('rejects an invalid anchor loudly', () => {
    expect(() =>
      createHighlight({
        documentId: 'doc',
        anchor: { type: 'text', page: 0, quote: 'x', rects: [] },
      }),
    ).toThrow(/Invalid anchor/)
  })
})

describe('rectFromCorners / unionRects', () => {
  it('normalizes corner order', () => {
    expect(rectFromCorners(10, 20, 2, 5)).toEqual(rect(2, 5, 8, 15))
  })

  it('unions rectangles and rejects empty input', () => {
    expect(unionRects([rect(0, 0, 1, 1), rect(5, 5, 1, 1)])).toEqual(
      rect(0, 0, 6, 6),
    )
    expect(() => unionRects([])).toThrow()
  })
})

describe('mergeLineRects', () => {
  it('merges adjacent fragments on one line and keeps separate lines', () => {
    const merged = mergeLineRects([
      rect(10, 700, 50, 10), // line 1, fragment 1
      rect(60, 700, 40, 10), // line 1, fragment 2 (touching)
      rect(10, 685, 80, 10), // line 2
      rect(0, 0, 0, 10), // zero width, dropped
    ])
    expect(merged).toEqual([rect(10, 700, 90, 10), rect(10, 685, 80, 10)])
  })

  it('does not merge fragments with a horizontal gap', () => {
    const merged = mergeLineRects([rect(0, 0, 10, 10), rect(30, 0, 10, 10)])
    expect(merged).toHaveLength(2)
  })
})

describe('isAnchor / isAnnotation', () => {
  it('accepts text and region anchors', () => {
    expect(
      isAnchor({
        type: 'text',
        page: 1,
        quote: 'q',
        rects: [rect(0, 0, 1, 1)],
      }),
    ).toBe(true)
    expect(
      isAnchor({
        type: 'text',
        page: 1,
        quote: 'q',
        rects: [rect(0, 0, 1, 1)],
        textOffsets: { start: 3, end: 9 },
      }),
    ).toBe(true)
    expect(isAnchor({ type: 'region', page: 3, rect: rect(0, 0, 1, 1) })).toBe(
      true,
    )
  })

  it('rejects malformed anchors', () => {
    expect(isAnchor({ type: 'text', page: 1, quote: 'q', rects: [] })).toBe(
      false,
    )
    expect(isAnchor({ type: 'region', page: 1 })).toBe(false)
    expect(
      isAnchor({
        type: 'text',
        page: 1.5,
        quote: 'q',
        rects: [rect(0, 0, 1, 1)],
      }),
    ).toBe(false)
    expect(
      isAnchor({
        type: 'text',
        page: 1,
        quote: 'q',
        rects: [rect(0, 0, 1, 1)],
        textOffsets: { start: 5, end: 2 },
      }),
    ).toBe(false)
    expect(
      isAnchor({
        type: 'region',
        page: 1,
        rect: { x: NaN, y: 0, width: 1, height: 1 },
      }),
    ).toBe(false)
  })

  it('rejects records from another schema version or with local timestamps', () => {
    const good: Annotation = createHighlight(
      {
        documentId: 'd',
        anchor: { type: 'region', page: 1, rect: rect(0, 0, 1, 1) },
      },
      new Date('2026-01-01T00:00:00Z'),
    )
    expect(isAnnotation({ ...good, schemaVersion: 2 })).toBe(false)
    expect(
      isAnnotation({ ...good, createdAt: '2026-01-01T00:00:00+02:00' }),
    ).toBe(false)
    expect(isAnnotation({ ...good, kind: 'sticker' })).toBe(false)
    expect(isAnnotation(null)).toBe(false)
  })
})
