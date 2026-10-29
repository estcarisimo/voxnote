import type {
  Anchor,
  Annotation,
  AnnotationKind,
  Visibility,
} from './annotations'

/** How the review sidebar groups a document's annotations. */
export type GroupBy = 'kind' | 'visibility' | 'page'

export const GROUP_BY_OPTIONS: readonly GroupBy[] = [
  'kind',
  'visibility',
  'page',
]

export function isGroupBy(value: unknown): value is GroupBy {
  return (
    typeof value === 'string' && GROUP_BY_OPTIONS.includes(value as GroupBy)
  )
}

export const KIND_LABELS: Record<AnnotationKind, string> = {
  highlight: 'Highlights',
  comment: 'Comments',
  suggestion: 'Suggestions',
}

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  private: 'Private',
  'author-facing': 'For the author',
}

const KIND_ORDER: readonly AnnotationKind[] = [
  'suggestion',
  'comment',
  'highlight',
]
const VISIBILITY_ORDER: readonly Visibility[] = ['author-facing', 'private']

export interface ReviewFilter {
  /** Kinds to show; empty means every kind. */
  kinds: readonly AnnotationKind[]
  /** Only this visibility; null means both. */
  visibility: Visibility | null
  /** Case-insensitive match against quote, body, original and raw transcript. */
  query: string
  /** Only voice notes whose recording has not been transcribed yet. */
  untranscribedOnly: boolean
}

export const EMPTY_FILTER: ReviewFilter = {
  kinds: [],
  visibility: null,
  query: '',
  untranscribedOnly: false,
}

export function isFilterActive(filter: ReviewFilter): boolean {
  return (
    filter.kinds.length > 0 ||
    filter.visibility !== null ||
    filter.query.trim() !== '' ||
    filter.untranscribedOnly
  )
}

/** The highest PDF-space y edge of an anchor: larger is higher on the page. */
export function topOf(anchor: Anchor): number {
  const rects = anchor.type === 'text' ? anchor.rects : [anchor.rect]
  return Math.max(...rects.map((r) => r.y + r.height))
}

export function leftOf(anchor: Anchor): number {
  const rects = anchor.type === 'text' ? anchor.rects : [anchor.rect]
  return Math.min(...rects.map((r) => r.x))
}

/**
 * Reading order: page, then top to bottom (PDF y grows upward), then left to
 * right, then creation time, then id so the order is total and stable.
 */
export function compareAnnotations(a: Annotation, b: Annotation): number {
  if (a.anchor.page !== b.anchor.page) return a.anchor.page - b.anchor.page
  const top = topOf(b.anchor) - topOf(a.anchor)
  if (top !== 0) return top
  const left = leftOf(a.anchor) - leftOf(b.anchor)
  if (left !== 0) return left
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function sortAnnotations(
  annotations: readonly Annotation[],
): Annotation[] {
  return [...annotations].sort(compareAnnotations)
}

/** Everything a text search should look at, lower-cased. */
export function searchableText(a: Annotation): string {
  const parts: string[] = []
  if (a.anchor.type === 'text') parts.push(a.anchor.quote)
  if (a.kind !== 'highlight') {
    parts.push(a.body)
    if (a.voice?.transcript) parts.push(a.voice.transcript.raw)
  }
  if (a.kind === 'suggestion') parts.push(a.original)
  return parts.join('\n').toLowerCase()
}

export function matchesFilter(a: Annotation, filter: ReviewFilter): boolean {
  if (filter.kinds.length > 0 && !filter.kinds.includes(a.kind)) return false
  if (filter.visibility !== null && a.visibility !== filter.visibility) {
    return false
  }
  if (filter.untranscribedOnly) {
    const untranscribed =
      a.kind !== 'highlight' && a.voice !== undefined && !a.voice.transcript
    if (!untranscribed) return false
  }
  const query = filter.query.trim().toLowerCase()
  if (query !== '' && !searchableText(a).includes(query)) return false
  return true
}

export function filterAnnotations(
  annotations: readonly Annotation[],
  filter: ReviewFilter,
): Annotation[] {
  return sortAnnotations(annotations.filter((a) => matchesFilter(a, filter)))
}

export interface ReviewGroup {
  /** Stable key for React and tests: the kind, the visibility or `page-N`. */
  key: string
  label: string
  annotations: Annotation[]
}

/**
 * Splits an already filtered list into non-empty groups, in a fixed order:
 * suggestions, comments, highlights; for the author before private; pages
 * ascending. Each group keeps reading order.
 */
export function groupAnnotations(
  annotations: readonly Annotation[],
  by: GroupBy,
): ReviewGroup[] {
  const sorted = sortAnnotations(annotations)
  switch (by) {
    case 'kind':
      return KIND_ORDER.map((kind) => ({
        key: kind,
        label: KIND_LABELS[kind],
        annotations: sorted.filter((a) => a.kind === kind),
      })).filter((g) => g.annotations.length > 0)
    case 'visibility':
      return VISIBILITY_ORDER.map((visibility) => ({
        key: visibility,
        label: VISIBILITY_LABELS[visibility],
        annotations: sorted.filter((a) => a.visibility === visibility),
      })).filter((g) => g.annotations.length > 0)
    case 'page': {
      const groups: ReviewGroup[] = []
      for (const a of sorted) {
        const last = groups[groups.length - 1]
        if (last && last.key === `page-${a.anchor.page}`) {
          last.annotations.push(a)
        } else {
          groups.push({
            key: `page-${a.anchor.page}`,
            label: `Page ${a.anchor.page}`,
            annotations: [a],
          })
        }
      }
      return groups
    }
  }
}
