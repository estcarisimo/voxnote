/**
 * Annotation data model. Pure, framework-free, and the single place where the
 * on-disk JSON shape is defined. Bump ANNOTATION_SCHEMA_VERSION and add a
 * migration in the store whenever this shape changes.
 */

export const ANNOTATION_SCHEMA_VERSION = 1

/**
 * A rectangle in PDF user space: points, origin at the bottom-left of the
 * page, y growing upwards. Independent of zoom and device pixel ratio, and
 * the same space native PDF annotations use.
 */
export interface PdfRect {
  x: number
  y: number
  width: number
  height: number
}

/** A run of selected text on one page. */
export interface TextAnchor {
  type: 'text'
  page: number
  /** The selected text, whitespace-normalized. */
  quote: string
  /** One rectangle per visual line (or fragment) of the selection. */
  rects: PdfRect[]
  /**
   * Character offsets into the page's text layer, when they could be
   * computed. Lets a future version re-anchor after re-extraction.
   */
  textOffsets?: { start: number; end: number }
}

/** A rectangular region with no text, for figures, charts, equations. */
export interface RegionAnchor {
  type: 'region'
  page: number
  rect: PdfRect
}

export type Anchor = TextAnchor | RegionAnchor

export type AnnotationKind = 'highlight' | 'comment' | 'suggestion'

export type Visibility = 'private' | 'author-facing'

export interface Annotation {
  schemaVersion: typeof ANNOTATION_SCHEMA_VERSION
  id: string
  /** SHA-256 of the PDF bytes; see computeDocumentId. */
  documentId: string
  kind: AnnotationKind
  anchor: Anchor
  visibility: Visibility
  /** ISO 8601 timestamps in UTC (always end in "Z"). */
  createdAt: string
  updatedAt: string
}

export interface CreateHighlightInput {
  documentId: string
  anchor: Anchor
  visibility?: Visibility
}

export function createHighlight(
  input: CreateHighlightInput,
  now: Date = new Date(),
): Annotation {
  validateAnchor(input.anchor)
  const timestamp = now.toISOString()
  return {
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    documentId: input.documentId,
    kind: 'highlight',
    anchor: input.anchor,
    visibility: input.visibility ?? 'private',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

/** Builds a PdfRect from any two opposite corners. */
export function rectFromCorners(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): PdfRect {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  }
}

/** Smallest rectangle containing all the given ones. Throws on empty input. */
export function unionRects(rects: readonly PdfRect[]): PdfRect {
  if (rects.length === 0) throw new Error('unionRects: no rectangles')
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const r of rects) {
    x1 = Math.min(x1, r.x)
    y1 = Math.min(y1, r.y)
    x2 = Math.max(x2, r.x + r.width)
    y2 = Math.max(y2, r.y + r.height)
  }
  return rectFromCorners(x1, y1, x2, y2)
}

/**
 * Merges rectangles that sit on the same line and touch or overlap
 * horizontally, so a selection spanning several text spans yields one
 * rectangle per line instead of one per span. Rectangles are considered on
 * the same line when their vertical extents overlap by more than half of the
 * smaller height. Zero-area rectangles are dropped.
 */
export function mergeLineRects(rects: readonly PdfRect[]): PdfRect[] {
  const sorted = rects
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({ ...r }))
    .sort((a, b) => b.y - a.y || a.x - b.x)
  const merged: PdfRect[] = []
  for (const r of sorted) {
    const last = merged[merged.length - 1]
    if (last && sameLine(last, r) && r.x <= last.x + last.width + 1) {
      const union = unionRects([last, r])
      merged[merged.length - 1] = union
    } else {
      merged.push(r)
    }
  }
  return merged
}

function sameLine(a: PdfRect, b: PdfRect): boolean {
  const top = Math.min(a.y + a.height, b.y + b.height)
  const bottom = Math.max(a.y, b.y)
  const overlap = top - bottom
  return overlap > Math.min(a.height, b.height) / 2
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function isPdfRect(value: unknown): value is PdfRect {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  return (
    isFiniteNumber(r.x) &&
    isFiniteNumber(r.y) &&
    isFiniteNumber(r.width) &&
    isFiniteNumber(r.height) &&
    r.width >= 0 &&
    r.height >= 0
  )
}

export function isAnchor(value: unknown): value is Anchor {
  if (typeof value !== 'object' || value === null) return false
  const a = value as Record<string, unknown>
  if (!Number.isInteger(a.page) || (a.page as number) < 1) return false
  if (a.type === 'region') return isPdfRect(a.rect)
  if (a.type === 'text') {
    if (typeof a.quote !== 'string') return false
    if (!Array.isArray(a.rects) || a.rects.length === 0) return false
    if (!a.rects.every(isPdfRect)) return false
    if (a.textOffsets !== undefined) {
      const o = a.textOffsets as Record<string, unknown>
      if (
        typeof o !== 'object' ||
        o === null ||
        !Number.isInteger(o.start) ||
        !Number.isInteger(o.end) ||
        (o.start as number) < 0 ||
        (o.end as number) < (o.start as number)
      ) {
        return false
      }
    }
    return true
  }
  return false
}

const KINDS: readonly string[] = ['highlight', 'comment', 'suggestion']
const VISIBILITIES: readonly string[] = ['private', 'author-facing']
const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

/** Structural validation for records read from storage or import files. */
export function isAnnotation(value: unknown): value is Annotation {
  if (typeof value !== 'object' || value === null) return false
  const a = value as Record<string, unknown>
  return (
    a.schemaVersion === ANNOTATION_SCHEMA_VERSION &&
    typeof a.id === 'string' &&
    a.id.length > 0 &&
    typeof a.documentId === 'string' &&
    a.documentId.length > 0 &&
    typeof a.kind === 'string' &&
    KINDS.includes(a.kind) &&
    isAnchor(a.anchor) &&
    typeof a.visibility === 'string' &&
    VISIBILITIES.includes(a.visibility) &&
    typeof a.createdAt === 'string' &&
    UTC_ISO.test(a.createdAt) &&
    typeof a.updatedAt === 'string' &&
    UTC_ISO.test(a.updatedAt)
  )
}

function validateAnchor(anchor: Anchor): void {
  if (!isAnchor(anchor)) {
    throw new Error(`Invalid anchor: ${JSON.stringify(anchor)}`)
  }
}
