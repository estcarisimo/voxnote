import { describe, expect, it } from 'vitest'
import {
  createComment,
  createHighlight,
  createSuggestion,
  withVisibility,
  type TextAnchor,
} from './annotations'
import {
  EMPTY_FILTER,
  filterAnnotations,
  groupAnnotations,
  isFilterActive,
  isGroupBy,
  matchesFilter,
  sortAnnotations,
} from './review'

const at = (page: number, y: number, x = 0, quote = 'q'): TextAnchor => ({
  type: 'text',
  page,
  quote,
  rects: [{ x, y, width: 10, height: 10 }],
})

const t0 = new Date('2026-10-29T10:00:00.000Z')
const t1 = new Date('2026-10-29T10:01:00.000Z')

describe('sortAnnotations', () => {
  it('orders by page, then top to bottom, then left to right, then creation', () => {
    const p2 = createHighlight({ documentId: 'd', anchor: at(2, 700) }, t0)
    const lowOnP1 = createHighlight({ documentId: 'd', anchor: at(1, 100) }, t0)
    const highOnP1 = createHighlight(
      { documentId: 'd', anchor: at(1, 700) },
      t0,
    )
    const highRight = createHighlight(
      { documentId: 'd', anchor: at(1, 700, 50) },
      t0,
    )
    const region = createHighlight(
      {
        documentId: 'd',
        anchor: {
          type: 'region',
          page: 1,
          rect: { x: 0, y: 400, width: 5, height: 5 },
        },
      },
      t0,
    )
    const later = createHighlight({ documentId: 'd', anchor: at(1, 100) }, t1)
    const sorted = sortAnnotations([
      later,
      p2,
      lowOnP1,
      region,
      highRight,
      highOnP1,
    ])
    expect(sorted.map((a) => a.id)).toEqual(
      [highOnP1, highRight, region, lowOnP1, later, p2].map((a) => a.id),
    )
  })

  it('does not mutate its input', () => {
    const a = createHighlight({ documentId: 'd', anchor: at(2, 0) })
    const b = createHighlight({ documentId: 'd', anchor: at(1, 0) })
    const input = [a, b]
    sortAnnotations(input)
    expect(input).toEqual([a, b])
  })
})

describe('matchesFilter / filterAnnotations', () => {
  const voice = {
    mimeType: 'audio/webm',
    durationMs: 1000,
    recordedAt: '2026-10-29T10:00:00.000Z',
  }
  const highlight = createHighlight({
    documentId: 'd',
    anchor: at(1, 700, 0, 'Figure 2 caption'),
  })
  const comment = createComment({
    documentId: 'd',
    anchor: at(1, 600, 0, 'the results'),
    body: 'Cite the source',
  })
  const dictated = createComment({
    documentId: 'd',
    anchor: at(2, 500),
    body: '',
    voice,
  })
  const transcribed = createComment({
    documentId: 'd',
    anchor: at(2, 400),
    body: 'edited body',
    voice: {
      ...voice,
      transcript: {
        raw: 'raw words only here',
        provider: 'openai/gpt-transcribe',
        transcribedAt: '2026-10-29T10:01:00.000Z',
      },
    },
  })
  const suggestion = withVisibility(
    createSuggestion({
      documentId: 'd',
      anchor: at(3, 300, 0, 'teh'),
      body: 'the',
    }),
    'author-facing',
  )
  const all = [highlight, comment, dictated, transcribed, suggestion]

  it('matches everything with the empty filter and reports it inactive', () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false)
    expect(filterAnnotations(all, EMPTY_FILTER)).toHaveLength(5)
  })

  it('filters by kind, visibility and untranscribed voice', () => {
    expect(
      filterAnnotations(all, { ...EMPTY_FILTER, kinds: ['comment'] }),
    ).toEqual([comment, dictated, transcribed])
    expect(
      filterAnnotations(all, {
        ...EMPTY_FILTER,
        kinds: ['highlight', 'suggestion'],
      }),
    ).toEqual([highlight, suggestion])
    expect(
      filterAnnotations(all, { ...EMPTY_FILTER, visibility: 'author-facing' }),
    ).toEqual([suggestion])
    expect(
      filterAnnotations(all, { ...EMPTY_FILTER, untranscribedOnly: true }),
    ).toEqual([dictated])
    expect(isFilterActive({ ...EMPTY_FILTER, untranscribedOnly: true })).toBe(
      true,
    )
  })

  it('searches quote, body, original and the raw transcript, case-insensitively', () => {
    const q = (query: string) =>
      filterAnnotations(all, { ...EMPTY_FILTER, query })
    expect(q('figure')).toEqual([highlight])
    expect(q('SOURCE')).toEqual([comment])
    expect(q('raw words')).toEqual([transcribed])
    expect(q('teh')).toEqual([suggestion])
    expect(q('  the ')).toEqual([comment, suggestion])
    expect(q('nowhere')).toEqual([])
    expect(matchesFilter(highlight, { ...EMPTY_FILTER, query: '   ' })).toBe(
      true,
    )
  })

  it('combines criteria with AND', () => {
    expect(
      filterAnnotations(all, {
        ...EMPTY_FILTER,
        kinds: ['comment'],
        query: 'the',
      }),
    ).toEqual([comment])
  })
})

describe('groupAnnotations', () => {
  const h = createHighlight({ documentId: 'd', anchor: at(2, 0) })
  const c = createComment({ documentId: 'd', anchor: at(1, 100), body: 'b' })
  const s = withVisibility(
    createSuggestion({
      documentId: 'd',
      anchor: at(1, 500, 0, 'a'),
      body: 'b',
    }),
    'author-facing',
  )

  it('groups by kind in a fixed order and drops empty groups', () => {
    const groups = groupAnnotations([h, c, s], 'kind')
    expect(groups.map((g) => [g.key, g.label, g.annotations.length])).toEqual([
      ['suggestion', 'Suggestions', 1],
      ['comment', 'Comments', 1],
      ['highlight', 'Highlights', 1],
    ])
    expect(groupAnnotations([h], 'kind').map((g) => g.key)).toEqual([
      'highlight',
    ])
  })

  it('groups by visibility, author-facing first', () => {
    expect(
      groupAnnotations([h, c, s], 'visibility').map((g) => [
        g.label,
        g.annotations.map((a) => a.id),
      ]),
    ).toEqual([
      ['For the author', [s.id]],
      ['Private', [c.id, h.id]],
    ])
  })

  it('groups by page in reading order', () => {
    expect(
      groupAnnotations([h, c, s], 'page').map((g) => [
        g.key,
        g.label,
        g.annotations.map((a) => a.id),
      ]),
    ).toEqual([
      ['page-1', 'Page 1', [s.id, c.id]],
      ['page-2', 'Page 2', [h.id]],
    ])
    expect(groupAnnotations([], 'page')).toEqual([])
  })

  it('validates a group-by value read from storage', () => {
    expect(isGroupBy('kind')).toBe(true)
    expect(isGroupBy('colour')).toBe(false)
    expect(isGroupBy(null)).toBe(false)
  })
})
