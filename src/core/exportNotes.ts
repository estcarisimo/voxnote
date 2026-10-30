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
  unionRects,
  type Anchor,
  type Annotation,
  type CleanUp,
  type VoiceNote,
} from './annotations'
import { cleanUpLabel } from './cleanUp'

/** Version of the JSON export envelope, independent of the annotation schema. */
export const NOTES_EXPORT_SCHEMA_VERSION = 1

/** What the export needs to know about the document, not the pdf.js object. */
export interface ExportDocument {
  /** File name as opened, e.g. "paper.pdf". */
  name: string
  /** SHA-256 of the PDF bytes; see computeDocumentId. */
  id: string
  pageCount: number
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
    document: {
      name: document.name,
      id: document.id,
      pageCount: document.pageCount,
    },
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
    `- Pages: ${document.pageCount}`,
    `- Annotations: ${sorted.length}`,
  ]
  if (sorted.length === 0) {
    lines.push('', 'No annotations.')
  }
  let page = 0
  for (const annotation of sorted) {
    if (annotation.anchor.page !== page) {
      page = annotation.anchor.page
      lines.push('', `## Page ${page}`, '')
    }
    lines.push(...itemLines(annotation))
  }
  return lines.join('\n') + '\n'
}

/**
 * Fails loudly on anything the export would misrepresent: a malformed
 * record, one from another document, or one past the last page. Returns the
 * annotations in reading order: page, then top to bottom, then createdAt,
 * then id so equal positions still sort the same way every time.
 */
function validatedAndSorted(
  document: ExportDocument,
  annotations: readonly Annotation[],
): Annotation[] {
  if (!Number.isInteger(document.pageCount) || document.pageCount < 1) {
    throw new Error(`Invalid page count: ${document.pageCount}`)
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
    if (annotation.anchor.page > document.pageCount) {
      throw new Error(
        `Annotation ${annotation.id} points at page ${annotation.anchor.page}, but the document has ${document.pageCount}`,
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

/** Top edge in PDF user space, where y grows upwards. */
function topOf(anchor: Anchor): number {
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
  const lines = [
    `- **${KIND_LABELS[annotation.kind]}** (${annotation.visibility}), created ${annotation.createdAt} (UTC)`,
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
    if (anchor.type === 'text') {
      lines.push(...field('Passage', anchor.quote))
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
