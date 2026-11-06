/**
 * Exports a document's annotations as a human-readable Markdown report and as
 * machine-readable JSON. Pure and framework-free: both return a string, and
 * the caller decides what to do with it. Nothing here sends anything anywhere.
 *
 * Voice recordings are never included: the report describes them (duration,
 * raw transcript) and the JSON carries the voice-note metadata exactly as
 * stored, without the audio bytes.
 */
import {
  isAnnotation,
  quoteOf,
  unionRects,
  type Anchor,
  type Annotation,
  type CleanUp,
  type VoiceNote,
} from './annotations'
import { cleanUpLabel } from './cleanUp'
import { HIGHLIGHT_PALETTE } from './palette'
import { placeLabel } from './review'

/**
 * Version of the JSON export envelope, independent of the annotation schema.
 * v1: PDF documents only (`pageCount`). v2: `kind`, with `blockCount` for a
 * Markdown document.
 */
export const NOTES_EXPORT_SCHEMA_VERSION = 2

/**
 * What the export needs to know about the document, not the pdf.js object
 * or the block tree. `id` is the SHA-256 of the file's bytes; see
 * computeDocumentId.
 */
export type ExportDocument =
  | {
      kind: 'pdf'
      /** File name as opened, e.g. "paper.pdf". */
      name: string
      id: string
      pageCount: number
    }
  | {
      kind: 'markdown'
      name: string
      id: string
      /** Top-level blocks; anchors count them like pages. */
      blockCount: number
    }

/** The document fields the JSON carries, and nothing a caller added. */
function describeDocument(document: ExportDocument): ExportDocument {
  const { name, id } = document
  return document.kind === 'pdf'
    ? { kind: 'pdf', name, id, pageCount: document.pageCount }
    : { kind: 'markdown', name, id, blockCount: document.blockCount }
}

/** How many containers (pages or top-level blocks) the document has. */
export function containerCount(document: ExportDocument): number {
  return document.kind === 'pdf' ? document.pageCount : document.blockCount
}

export interface NotesExport {
  schemaVersion: typeof NOTES_EXPORT_SCHEMA_VERSION
  /** UTC, ISO 8601. */
  exportedAt: string
  document: ExportDocument
  annotations: Annotation[]
}

export function exportJson(
  document: ExportDocument,
  annotations: readonly Annotation[],
  now: Date = new Date(),
): string {
  const sorted = validatedAndSorted(document, annotations)
  const payload: NotesExport = {
    schemaVersion: NOTES_EXPORT_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    document: describeDocument(document),
    annotations: sorted,
  }
  return JSON.stringify(payload, null, 2) + '\n'
}

export function exportMarkdown(
  document: ExportDocument,
  annotations: readonly Annotation[],
  now: Date = new Date(),
): string {
  const sorted = validatedAndSorted(document, annotations)
  const lines: string[] = [
    `# VoxNote review: ${escapeInline(document.name)}`,
    '',
    `- Exported: ${now.toISOString()} (UTC)`,
    `- Document id (SHA-256): \`${document.id}\``,
    `- ${document.kind === 'pdf' ? 'Pages' : 'Blocks'}: ${containerCount(document)}`,
    `- Annotations: ${sorted.length}`,
  ]
  if (sorted.length === 0) {
    lines.push('', 'No annotations.')
  }
  let page = 0
  for (const annotation of sorted) {
    if (annotation.anchor.page !== page) {
      page = annotation.anchor.page
      lines.push('', `## ${placeLabel(annotation.anchor)}`, '')
    }
    lines.push(...itemLines(annotation))
  }
  return lines.join('\n') + '\n'
}

/**
 * Fails loudly on anything the export would misrepresent: a malformed
 * record, one from another document, one past the last page or block, or a
 * PDF anchor in a Markdown document and the reverse. Returns the
 * annotations in reading order: page, then top to bottom, then createdAt,
 * then id so equal positions still sort the same way every time.
 */
function validatedAndSorted(
  document: ExportDocument,
  annotations: readonly Annotation[],
): Annotation[] {
  const count = containerCount(document)
  const unit = document.kind === 'pdf' ? 'page' : 'block'
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`Invalid ${unit} count: ${count}`)
  }
  for (const annotation of annotations) {
    if (!isAnnotation(annotation)) {
      throw new Error(`Invalid annotation: ${JSON.stringify(annotation)}`)
    }
    if (annotation.documentId !== document.id) {
      throw new Error(
        `Annotation ${annotation.id} belongs to document ${annotation.documentId}, not ${document.id}`,
      )
    }
    const isBlockAnchor = annotation.anchor.type === 'block-text'
    if (isBlockAnchor !== (document.kind === 'markdown')) {
      throw new Error(
        `Annotation ${annotation.id} has a ${annotation.anchor.type} anchor, which does not belong in a ${document.kind} document`,
      )
    }
    if (annotation.anchor.page > count) {
      throw new Error(
        `Annotation ${annotation.id} points at ${unit} ${annotation.anchor.page}, but the document has ${count}`,
      )
    }
  }
  return [...annotations].sort(
    (a, b) =>
      a.anchor.page - b.anchor.page ||
      topOf(b.anchor) - topOf(a.anchor) ||
      compareStrings(a.createdAt, b.createdAt) ||
      compareStrings(a.id, b.id),
  )
}

/** Top edge in PDF user space, where y grows upwards; see review.topOf. */
function topOf(anchor: Anchor): number {
  if (anchor.type === 'block-text') return -anchor.start
  const r = anchor.type === 'text' ? unionRects(anchor.rects) : anchor.rect
  return r.y + r.height
}

/** Code-unit order, not locale order, so the result never depends on the host. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

const KIND_LABELS = {
  highlight: 'Highlight',
  comment: 'Comment',
  suggestion: 'Suggestion',
} as const

function itemLines(annotation: Annotation): string[] {
  const { anchor } = annotation
  const tags: string[] = [annotation.visibility]
  if (annotation.kind === 'highlight') {
    tags.push(HIGHLIGHT_PALETTE[annotation.color].label.toLowerCase())
  }
  const lines = [
    `- **${KIND_LABELS[annotation.kind]}** (${tags.join(', ')}), created ${annotation.createdAt} (UTC)`,
  ]
  if (annotation.kind === 'suggestion') {
    lines.push(...field('Original', annotation.original))
    if (annotation.body.trim() === '') {
      lines.push('  - Replacement: recorded by voice; not transcribed yet.')
    } else {
      lines.push(
        ...field(
          withCleanUpLabel('Replacement', annotation.cleanUp),
          annotation.body,
        ),
      )
    }
  } else {
    const quote = quoteOf(anchor)
    if (quote !== null) {
      lines.push(...field('Passage', quote))
    } else {
      lines.push(`  - Region on page ${anchor.page}`)
    }
    if (annotation.kind === 'comment') {
      if (annotation.body.trim() === '') {
        lines.push('  - Comment: recorded by voice; not transcribed yet.')
      } else {
        lines.push(
          ...field(
            withCleanUpLabel('Comment', annotation.cleanUp),
            annotation.body,
          ),
        )
      }
    }
  }
  if (annotation.kind !== 'highlight' && annotation.voice) {
    lines.push(...voiceLines(annotation.voice))
  }
  return lines
}

/**
 * Marks a body that is an LLM clean-up of the raw transcript, so a reader
 * never mistakes it for the reviewer's verbatim words.
 */
function withCleanUpLabel(label: string, cleanUp: CleanUp | undefined): string {
  if (!cleanUp) return label
  const edited = cleanUp.editedAfter ? ', then edited by the reviewer' : ''
  return (
    `${label} (polished with ${cleanUpLabel(cleanUp)}, ${cleanUp.createdAt} UTC, ` +
    `prompt v${cleanUp.promptVersion}${edited}; the raw transcript is below)`
  )
}

function voiceLines(voice: VoiceNote): string[] {
  const lines = [
    `  - Voice note: ${formatDuration(voice.durationMs)}, recorded ${voice.recordedAt} (UTC)`,
  ]
  const t = voice.transcript
  if (!t) {
    lines.push('  - Transcript: not transcribed yet.')
    return lines
  }
  const language = t.language ? `, language ${t.language}` : ''
  lines.push(
    ...field(
      `Raw transcript (unedited, ${t.provider}${language}, ${t.transcribedAt} UTC)`,
      t.raw,
    ),
  )
  return lines
}

/**
 * A labeled sub-item with the user's text as a blockquote under it, one
 * quoted line per source line, so line breaks survive and Markdown in the
 * text cannot end the list item or start a new section.
 */
function field(label: string, text: string): string[] {
  const quoted = text
    .split(/\r\n|\r|\n/)
    .map((line) => `    > ${line}`.trimEnd())
  return [`  - ${label}:`, ...quoted]
}

function formatDuration(ms: number): string {
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)} min ${whole % 60} s`
}

/** Escapes the characters that would turn a file name into Markdown syntax. */
function escapeInline(text: string): string {
  return text.replace(/[\\`*_[\]<>#|]/g, (c) => `\\${c}`)
}
