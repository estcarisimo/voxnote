/**
 * Annotation data model. Pure, framework-free, and the single place where the
 * on-disk JSON shape is defined. Bump ANNOTATION_SCHEMA_VERSION and add a
 * migration in the store whenever this shape changes.
 */

import {
  DEFAULT_HIGHLIGHT_COLOR,
  isHighlightColor,
  type HighlightColor,
} from './palette'

export const ANNOTATION_SCHEMA_VERSION = 3
// Schema history. v1: highlights, comments, suggestions, voice notes. v2:
// the optional `cleanUp` record on notes; a v1 record is a valid v2 record
// without `cleanUp`. v3: the required `color` on highlights, from the fixed
// palette in ./palette (an older highlight gets the default, yellow, the one
// color every highlight had before), and the `block-text` anchor for
// Markdown documents, which no older record can carry.

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

/**
 * A run of selected text on one page of a PDF. `page` is the position of the
 * anchor's container in the document: a page in a PDF, a top-level block in
 * a Markdown document (see BlockTextAnchor). Every anchor has one.
 */
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

/**
 * A run of selected text in a rendered Markdown document: the top-level
 * block it sits in, by 1-based ordinal (in `page`, see TextAnchor), and
 * character offsets into that block's plain text (`blockPlainText` in
 * markdown.ts, equal to the rendered element's `textContent`). No
 * rectangles: marks are drawn from the DOM at render time.
 */
export interface BlockTextAnchor {
  type: 'block-text'
  /** 1-based ordinal of the top-level block. */
  page: number
  /** The selected text, whitespace-normalized. */
  quote: string
  /** Offsets into the block's plain text; `end` is exclusive. */
  start: number
  end: number
}

export type Anchor = TextAnchor | RegionAnchor | BlockTextAnchor

/** The anchors that carry a quote and so can be commented on by passage. */
export type QuoteAnchor = TextAnchor | BlockTextAnchor

/** The selected passage, or null for a region. */
export function quoteOf(anchor: Anchor): string | null {
  return anchor.type === 'region' ? null : anchor.quote
}

export function isQuoteAnchor(anchor: Anchor): anchor is QuoteAnchor {
  return anchor.type === 'text' || anchor.type === 'block-text'
}

export type AnnotationKind = 'highlight' | 'comment' | 'suggestion'

export type Visibility = 'private' | 'author-facing'

interface AnnotationBase {
  schemaVersion: typeof ANNOTATION_SCHEMA_VERSION
  id: string
  /** SHA-256 of the PDF bytes; see computeDocumentId. */
  documentId: string
  anchor: Anchor
  visibility: Visibility
  /** ISO 8601 timestamps in UTC (always end in "Z"). */
  createdAt: string
  updatedAt: string
}

export interface Highlight extends AnnotationBase {
  kind: 'highlight'
  /** A name from the fixed palette; see HIGHLIGHT_PALETTE. */
  color: HighlightColor
}

/**
 * What a speech-to-text provider returned for a voice note. Kept verbatim and
 * never edited: the user edits the comment body, not this.
 */
export interface Transcript {
  raw: string
  /** Provider and model that produced it, e.g. "openai/gpt-4o-transcribe". */
  provider: string
  /** BCP 47 tag when the provider reported one. */
  language?: string
  /** UTC. */
  transcribedAt: string
}

/**
 * A recording attached to a comment. The audio bytes live in the store's
 * audio table under the annotation id (see AnnotationStore.getAudio); this
 * record only carries what is needed to describe and replay them.
 */
export interface VoiceNote {
  mimeType: string
  durationMs: number
  /** UTC. */
  recordedAt: string
  transcript?: Transcript
}

/**
 * Marks a body that came from an LLM clean-up of the raw transcript, which
 * the user reviewed and accepted. The raw transcript itself is never touched.
 */
export interface CleanUp {
  /** Text provider id, e.g. "anthropic". */
  provider: string
  /** Model id as sent, e.g. "claude-opus-5-5". */
  model: string
  /** UTC, when the clean-up was produced. */
  createdAt: string
  /** CLEAN_UP_PROMPT_VERSION of the instruction that produced it. */
  promptVersion: number
  /** True once the user changed the body after accepting the clean-up. */
  editedAfter?: boolean
}

/** A note attached to an anchor, typed or dictated. */
export interface Comment extends AnnotationBase {
  kind: 'comment'
  /** The editable text. Starts as the raw transcript when dictated. */
  body: string
  voice?: VoiceNote
  cleanUp?: CleanUp
}

/**
 * A proposed replacement for the anchored text, Google Docs style. The PDF
 * is never changed: `original` records what the reviewer selected and
 * `body` holds the replacement they typed or dictated.
 */
export interface Suggestion extends AnnotationBase {
  kind: 'suggestion'
  anchor: QuoteAnchor
  /**
   * The selected text at the time of the suggestion. Authoritative for
   * display and export even if quote extraction changes later; it is not
   * required to equal `anchor.quote`.
   */
  original: string
  /** The proposed replacement; empty until a dictation is transcribed. */
  body: string
  voice?: VoiceNote
  cleanUp?: CleanUp
}

/** The kinds that carry editable text and an optional recording. */
export type Note = Comment | Suggestion

export type Annotation = Highlight | Note

export interface CreateHighlightInput {
  documentId: string
  anchor: Anchor
  visibility?: Visibility
  /** Defaults to DEFAULT_HIGHLIGHT_COLOR. */
  color?: HighlightColor
}

export function createHighlight(
  input: CreateHighlightInput,
  now: Date = new Date(),
): Highlight {
  const color = input.color ?? DEFAULT_HIGHLIGHT_COLOR
  if (!isHighlightColor(color)) {
    throw new Error(`Unknown highlight color "${String(color)}"`)
  }
  return { ...base(input, now), kind: 'highlight', color }
}

/** Notes have no color of their own; the palette is for highlights. */
export type CreateNoteInput = Omit<CreateHighlightInput, 'color'>

export interface CreateCommentInput extends CreateNoteInput {
  body: string
  voice?: VoiceNote
  /** Set when the body is an accepted clean-up of the voice transcript. */
  cleanUp?: CleanUp
}

/**
 * A comment needs something to say: a body, or a voice note that will be
 * transcribed or listened to later. An empty typed comment is a mistake.
 */
export function createComment(
  input: CreateCommentInput,
  now: Date = new Date(),
): Comment {
  if (input.body.trim() === '' && !input.voice) {
    throw new Error('A comment needs a body or a voice note')
  }
  if (input.voice && !isVoiceNote(input.voice)) {
    throw new Error(`Invalid voice note: ${JSON.stringify(input.voice)}`)
  }
  const comment: Comment = {
    ...base(input, now),
    kind: 'comment',
    body: input.body,
  }
  if (input.voice) comment.voice = input.voice
  if (input.cleanUp) {
    assertCleanUpAllowed(comment, input.cleanUp)
    comment.cleanUp = input.cleanUp
  }
  return comment
}

export interface CreateSuggestionInput extends CreateNoteInput {
  anchor: QuoteAnchor
  /** The replacement text; may be empty when a voice note is attached. */
  body: string
  voice?: VoiceNote
  /** Set when the body is an accepted clean-up of the voice transcript. */
  cleanUp?: CleanUp
}

/**
 * A suggestion must propose a change: the replacement differs from the
 * selected text, or a recording is attached that will say what to change.
 */
export function createSuggestion(
  input: CreateSuggestionInput,
  now: Date = new Date(),
): Suggestion {
  if (!isQuoteAnchor(input.anchor) || input.anchor.quote.trim() === '') {
    throw new Error('A suggestion needs selected text to replace')
  }
  if (input.voice && !isVoiceNote(input.voice)) {
    throw new Error(`Invalid voice note: ${JSON.stringify(input.voice)}`)
  }
  const suggestion: Suggestion = {
    ...base(input, now),
    kind: 'suggestion',
    anchor: input.anchor,
    original: input.anchor.quote,
    body: input.body,
  }
  if (input.voice) suggestion.voice = input.voice
  if (input.cleanUp) {
    assertCleanUpAllowed(suggestion, input.cleanUp)
    suggestion.cleanUp = input.cleanUp
  }
  assertSuggestionChanges(suggestion)
  return suggestion
}

function assertSuggestionChanges(s: Suggestion): void {
  if (s.body.trim() === '') {
    if (!s.voice)
      throw new Error('A suggestion needs replacement text or a voice note')
    return
  }
  if (s.body.trim() === s.original.trim()) {
    throw new Error('A suggestion must change the text; it equals the original')
  }
}

/**
 * A clean-up record needs a raw transcript it was made from, and a body.
 * Throws otherwise: a "cleaned up" label on text with no source would lie.
 */
function assertCleanUpAllowed(note: Note, cleanUp: CleanUp): void {
  if (!isCleanUp(cleanUp)) {
    throw new Error(`Invalid polish record: ${JSON.stringify(cleanUp)}`)
  }
  if (!note.voice?.transcript) {
    throw new Error(
      `${labelOf(note)} ${note.id} has no raw transcript to polish`,
    )
  }
  if (note.body.trim() === '') {
    throw new Error('A polished note needs a body')
  }
}

/**
 * Returns a copy with the new body and a fresh updatedAt. A body that came
 * from a clean-up keeps its record, flagged as edited once the text changes,
 * and loses it when cleared.
 */
export function withBody<N extends Note>(
  note: N,
  body: string,
  now: Date = new Date(),
): N {
  const updated: N = { ...note, body, updatedAt: now.toISOString() }
  if (note.cleanUp && body.trim() === '') {
    // Nothing cleaned up is left to label.
    delete updated.cleanUp
  } else if (note.cleanUp && body !== note.body) {
    updated.cleanUp = { ...note.cleanUp, editedAfter: true }
  }
  if (updated.kind === 'suggestion') {
    assertSuggestionChanges(updated)
  } else if (body.trim() === '' && !updated.voice) {
    throw new Error('A comment needs a body or a voice note')
  }
  return updated
}

/** Recolors a highlight from the palette; nothing else moves. */
export function withColor(
  highlight: Highlight,
  color: HighlightColor,
  now: Date = new Date(),
): Highlight {
  if (highlight.kind !== 'highlight') {
    throw new Error('Only a highlight has a color')
  }
  if (!isHighlightColor(color)) {
    throw new Error(`Unknown highlight color "${String(color)}"`)
  }
  return { ...highlight, color, updatedAt: now.toISOString() }
}

/** Changes who an annotation is meant for; nothing else moves. */
export function withVisibility<A extends Annotation>(
  annotation: A,
  visibility: Visibility,
  now: Date = new Date(),
): A {
  if (!VISIBILITIES.includes(visibility)) {
    throw new Error(`Unknown visibility "${String(visibility)}"`)
  }
  return { ...annotation, visibility, updatedAt: now.toISOString() }
}

/**
 * Attaches a provider's transcript to a dictated note. The raw text is kept
 * verbatim in the voice note; the editable body only takes it when the user
 * had not typed anything, so a typed note is never overwritten.
 */
export function withTranscript<N extends Note>(
  note: N,
  transcript: Transcript,
  now: Date = new Date(),
): N {
  if (!note.voice) {
    throw new Error(
      `${labelOf(note)} ${note.id} has no voice note to transcribe`,
    )
  }
  if (note.voice.transcript) {
    throw new Error(
      `${labelOf(note)} ${note.id} already has a transcript; the raw text is never replaced`,
    )
  }
  if (!isTranscript(transcript)) {
    throw new Error(`Invalid transcript: ${JSON.stringify(transcript)}`)
  }
  const updated: N = {
    ...note,
    body: note.body.trim() === '' ? transcript.raw : note.body,
    voice: { ...note.voice, transcript },
    updatedAt: now.toISOString(),
  }
  // A dictation that repeats the original is not a change; keep the body
  // empty so the user sees it needs editing, with the raw text preserved.
  if (
    updated.kind === 'suggestion' &&
    note.body.trim() === '' &&
    updated.body.trim() === updated.original.trim()
  ) {
    updated.body = ''
  }
  return updated
}

function labelOf(note: Note): string {
  return note.kind === 'suggestion' ? 'Suggestion' : 'Comment'
}

export function isNote(value: Annotation): value is Note {
  return value.kind === 'comment' || value.kind === 'suggestion'
}

function base(input: CreateNoteInput, now: Date): AnnotationBase {
  validateAnchor(input.anchor)
  const timestamp = now.toISOString()
  return {
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    documentId: input.documentId,
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
  if (a.type === 'block-text') {
    return (
      typeof a.quote === 'string' &&
      Number.isInteger(a.start) &&
      Number.isInteger(a.end) &&
      (a.start as number) >= 0 &&
      (a.end as number) > (a.start as number)
    )
  }
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

const VISIBILITIES: readonly string[] = ['private', 'author-facing']
const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

function isUtcTimestamp(value: unknown): value is string {
  return typeof value === 'string' && UTC_ISO.test(value)
}

export function isTranscript(value: unknown): value is Transcript {
  if (typeof value !== 'object' || value === null) return false
  const t = value as Record<string, unknown>
  return (
    typeof t.raw === 'string' &&
    typeof t.provider === 'string' &&
    t.provider.length > 0 &&
    (t.language === undefined || typeof t.language === 'string') &&
    isUtcTimestamp(t.transcribedAt)
  )
}

export function isVoiceNote(value: unknown): value is VoiceNote {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.mimeType === 'string' &&
    v.mimeType.length > 0 &&
    isFiniteNumber(v.durationMs) &&
    v.durationMs >= 0 &&
    isUtcTimestamp(v.recordedAt) &&
    (v.transcript === undefined || isTranscript(v.transcript))
  )
}

export function isCleanUp(value: unknown): value is CleanUp {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  return (
    typeof c.provider === 'string' &&
    c.provider.length > 0 &&
    typeof c.model === 'string' &&
    c.model.length > 0 &&
    isUtcTimestamp(c.createdAt) &&
    Number.isInteger(c.promptVersion) &&
    (c.promptVersion as number) >= 1 &&
    (c.editedAfter === undefined || typeof c.editedAfter === 'boolean')
  )
}

/** A clean-up record is only valid beside the transcript it came from. */
function cleanUpOk(a: Record<string, unknown>): boolean {
  if (a.cleanUp === undefined) return true
  if (!isCleanUp(a.cleanUp)) return false
  const voice = a.voice as VoiceNote | undefined
  return (
    voice?.transcript !== undefined &&
    typeof a.body === 'string' &&
    a.body.trim() !== ''
  )
}

/**
 * Brings a stored record of any supported schema version to the current
 * one. Returns the value unchanged when it is not a record of a known
 * version, so isAnnotation rejects it loudly instead of it being dropped.
 */
export function migrateAnnotation(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value
  const a = value as Record<string, unknown>
  if (a.schemaVersion !== 1 && a.schemaVersion !== 2) return value
  // v1 had no clean-up record; anything named so is not a v1 record.
  if (a.schemaVersion === 1 && 'cleanUp' in a) return value
  // Neither had a color; a highlight that names one is not one of them.
  if ('color' in a) return value
  // Neither had block-text anchors; a record with one is not one of them.
  const anchor = a.anchor as Record<string, unknown> | null | undefined
  if (anchor?.type === 'block-text') return value
  const migrated: Record<string, unknown> = {
    ...a,
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
  }
  if (a.kind === 'highlight') migrated.color = DEFAULT_HIGHLIGHT_COLOR
  return migrated
}

/** Structural validation for records read from storage or import files. */
export function isAnnotation(value: unknown): value is Annotation {
  if (typeof value !== 'object' || value === null) return false
  const a = value as Record<string, unknown>
  const baseOk =
    a.schemaVersion === ANNOTATION_SCHEMA_VERSION &&
    typeof a.id === 'string' &&
    a.id.length > 0 &&
    typeof a.documentId === 'string' &&
    a.documentId.length > 0 &&
    isAnchor(a.anchor) &&
    typeof a.visibility === 'string' &&
    VISIBILITIES.includes(a.visibility) &&
    isUtcTimestamp(a.createdAt) &&
    isUtcTimestamp(a.updatedAt)
  if (!baseOk) return false
  if (a.kind === 'highlight') {
    return a.cleanUp === undefined && isHighlightColor(a.color)
  }
  if (a.kind === 'comment') {
    if (typeof a.body !== 'string') return false
    if (a.voice !== undefined && !isVoiceNote(a.voice)) return false
    if (!cleanUpOk(a)) return false
    return a.body.trim() !== '' || a.voice !== undefined
  }
  if (a.kind === 'suggestion') {
    if (!isQuoteAnchor(a.anchor as Anchor)) return false
    if (typeof a.original !== 'string' || a.original.trim() === '') return false
    if (typeof a.body !== 'string') return false
    if (a.voice !== undefined && !isVoiceNote(a.voice)) return false
    if (!cleanUpOk(a)) return false
    if (a.body.trim() === '') return a.voice !== undefined
    return a.body.trim() !== a.original.trim()
  }
  return false
}

function validateAnchor(anchor: Anchor): void {
  if (!isAnchor(anchor)) {
    throw new Error(`Invalid anchor: ${JSON.stringify(anchor)}`)
  }
}
