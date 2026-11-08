/**
 * Reads a JSON notes export back (envelope v1 to v3, annotation schema v1 to
 * v3) and merges it into the annotation store. Pure apart from the store it
 * is handed; nothing here reads files or touches the UI.
 *
 * Invalid input is refused as a whole, with a message that says what is
 * wrong: one bad record is never skipped while the rest go in. The merge is
 * by annotation id: identical records are skipped, new ones added, and a
 * record whose id exists with different content is a conflict the caller
 * resolves (keep the local one or take the file's) before anything is
 * written.
 */
import {
  isAnnotation,
  isNote,
  migrateAnnotation,
  type Annotation,
} from './annotations'
import {
  NOTES_EXPORT_SCHEMA_VERSION,
  validatedAndSorted,
  type DocumentShape,
} from './exportNotes'
import type { AnnotationStore, DocumentLabel } from './store'

/** The document a notes file belongs to, as far as the file says. */
export type ImportedDocument = (
  { kind: 'pdf'; pageCount: number } | { kind: 'markdown'; blockCount: number }
) & {
  name: string
  /** SHA-256 of the file's bytes, hex. */
  id: string
  /** Bytes; null in files written before envelope v3. */
  size: number | null
}

export interface NotesFile {
  /** Envelope version the file was written with. */
  schemaVersion: number
  /** UTC, ISO 8601. */
  exportedAt: string
  /** The app version that wrote it; null before envelope v3. */
  appVersion: string | null
  document: ImportedDocument
  /** In the current annotation schema, validated against the document. */
  annotations: Annotation[]
}

/** A notes export, by name or type; never a document to review. */
export function isNotesFile(file: File): boolean {
  return (
    file.type === 'application/json' ||
    file.name.toLowerCase().endsWith('.json')
  )
}

/** Larger than any real export by orders of magnitude. */
export const MAX_NOTES_FILE_BYTES = 20 * 1024 * 1024

const SHA256_HEX = /^[0-9a-f]{64}$/
const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

/** Thrown for a file that is not a valid VoxNote notes export. */
export class InvalidNotesFile extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidNotesFile'
  }
}

/** Parses and validates a notes export; throws InvalidNotesFile otherwise. */
export function parseNotesFile(text: string): NotesFile {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (err: unknown) {
    throw new InvalidNotesFile(
      `This is not a VoxNote notes file: it is not valid JSON (${err instanceof Error ? err.message : String(err)}).`,
    )
  }
  if (!isRecord(value) || !('annotations' in value) || !('document' in value)) {
    throw new InvalidNotesFile(
      'This is not a VoxNote notes file: it has no document or annotations.',
    )
  }
  const version = value.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new InvalidNotesFile(
      `This notes file has no valid schemaVersion (${JSON.stringify(version)}).`,
    )
  }
  if (version > NOTES_EXPORT_SCHEMA_VERSION) {
    throw new InvalidNotesFile(
      `This notes file was written by a newer VoxNote (format ${version}); this version reads formats 1 to ${NOTES_EXPORT_SCHEMA_VERSION}. Update VoxNote and try again.`,
    )
  }
  if (version < 1) {
    throw new InvalidNotesFile(`Unknown notes file format ${version}.`)
  }
  if (typeof value.exportedAt !== 'string' || !UTC_ISO.test(value.exportedAt)) {
    throw new InvalidNotesFile(
      `The export time is not a UTC timestamp: ${JSON.stringify(value.exportedAt)}.`,
    )
  }
  const document = parseDocument(value.document, version)
  const appVersion = version >= 3 ? parseApp(value.app) : null
  const list: unknown = value.annotations
  if (!Array.isArray(list)) {
    throw new InvalidNotesFile('The annotations are not a list.')
  }
  const annotations: Annotation[] = []
  const ids = new Set<string>()
  list.forEach((raw: unknown, index: number) => {
    const record = migrateAnnotation(raw)
    if (!isAnnotation(record)) {
      throw new InvalidNotesFile(
        `Annotation ${index + 1} of ${list.length} is not a valid VoxNote annotation: ${truncate(JSON.stringify(raw))}`,
      )
    }
    if (record.documentId !== document.id) {
      throw new InvalidNotesFile(
        `Annotation ${record.id} belongs to document ${record.documentId}, not to ${document.id} named by the file.`,
      )
    }
    if (ids.has(record.id)) {
      throw new InvalidNotesFile(`Annotation ${record.id} appears twice.`)
    }
    ids.add(record.id)
    annotations.push(record)
  })
  try {
    validatedAndSorted(shapeOf(document), annotations)
  } catch (err: unknown) {
    throw new InvalidNotesFile(err instanceof Error ? err.message : String(err))
  }
  return {
    schemaVersion: version,
    exportedAt: value.exportedAt,
    appVersion,
    document,
    annotations,
  }
}

function parseDocument(value: unknown, version: number): ImportedDocument {
  if (!isRecord(value)) {
    throw new InvalidNotesFile('The document description is missing.')
  }
  const { name, id } = value
  if (typeof name !== 'string' || name.trim() === '') {
    throw new InvalidNotesFile('The document has no file name.')
  }
  if (typeof id !== 'string' || !SHA256_HEX.test(id)) {
    throw new InvalidNotesFile(
      `The document id is not a SHA-256 hash: ${JSON.stringify(id)}.`,
    )
  }
  let size: number | null = null
  if (version >= 3) {
    if (
      typeof value.size !== 'number' ||
      !Number.isInteger(value.size) ||
      value.size < 1
    ) {
      throw new InvalidNotesFile(
        `The document size is not a byte count: ${JSON.stringify(value.size)}.`,
      )
    }
    size = value.size
  }
  // v1 had PDF documents only and no `kind`.
  const kind = version === 1 ? 'pdf' : value.kind
  if (kind === 'pdf') {
    const pageCount = value.pageCount
    if (!isPositiveInteger(pageCount)) {
      throw new InvalidNotesFile(
        `The page count is invalid: ${JSON.stringify(pageCount)}.`,
      )
    }
    return { kind, name, id, size, pageCount }
  }
  if (kind === 'markdown') {
    const blockCount = value.blockCount
    if (!isPositiveInteger(blockCount)) {
      throw new InvalidNotesFile(
        `The block count is invalid: ${JSON.stringify(blockCount)}.`,
      )
    }
    return { kind, name, id, size, blockCount }
  }
  throw new InvalidNotesFile(
    `Unknown document kind: ${JSON.stringify(value.kind)}.`,
  )
}

function parseApp(value: unknown): string {
  if (
    !isRecord(value) ||
    value.name !== 'VoxNote' ||
    typeof value.version !== 'string' ||
    value.version === ''
  ) {
    throw new InvalidNotesFile(
      `The file does not say which VoxNote wrote it: ${truncate(JSON.stringify(value))}.`,
    )
  }
  return value.version
}

export function shapeOf(document: ImportedDocument): DocumentShape {
  return document.kind === 'pdf'
    ? { kind: 'pdf', id: document.id, pageCount: document.pageCount }
    : { kind: 'markdown', id: document.id, blockCount: document.blockCount }
}

export function labelOf(document: ImportedDocument): DocumentLabel {
  return { name: document.name, kind: document.kind }
}

/** A record present on both sides with different content. */
export interface Conflict {
  mine: Annotation
  theirs: Annotation
}

export interface MergePlan {
  /** In the file, not stored here. */
  added: Annotation[]
  /** In both, identical. */
  identical: Annotation[]
  conflicts: Conflict[]
}

/** Compares the file's annotations with the stored ones, by id. */
export function planMerge(
  existing: readonly Annotation[],
  incoming: readonly Annotation[],
): MergePlan {
  const byId = new Map(existing.map((a) => [a.id, a]))
  const plan: MergePlan = { added: [], identical: [], conflicts: [] }
  for (const theirs of incoming) {
    const mine = byId.get(theirs.id)
    if (!mine) plan.added.push(theirs)
    else if (canonical(mine) === canonical(theirs)) plan.identical.push(theirs)
    else plan.conflicts.push({ mine, theirs })
  }
  return plan
}

/** For each conflict, by annotation id: keep the local record or take the file's. */
export type Resolutions = Readonly<Record<string, 'mine' | 'theirs'>>

export interface ImportSummary {
  added: number
  /** Identical records, left as they were. */
  skipped: number
  conflicts: number
  keptMine: number
  tookFile: number
  /**
   * Voice notes now stored whose recording is not in this browser: notes
   * files carry the transcript, not the audio.
   */
  withoutRecording: number
}

/** The records a plan and its resolutions write. Throws on a missing choice. */
export function recordsToWrite(
  plan: MergePlan,
  resolutions: Resolutions,
): Annotation[] {
  const taken: Annotation[] = []
  for (const { theirs } of plan.conflicts) {
    const choice = resolutions[theirs.id]
    if (choice !== 'mine' && choice !== 'theirs') {
      throw new Error(
        `No choice was made for conflicting annotation ${theirs.id}`,
      )
    }
    if (choice === 'theirs') taken.push(theirs)
  }
  return [...plan.added, ...taken]
}

/**
 * Writes the plan to the store in one transaction and says what happened.
 * `document` names the document in the recent list.
 */
export async function applyMerge(
  store: AnnotationStore,
  plan: MergePlan,
  resolutions: Resolutions,
  document: DocumentLabel,
): Promise<ImportSummary> {
  const records = recordsToWrite(plan, resolutions)
  await store.putMany(records, document)
  let withoutRecording = 0
  for (const record of records) {
    if (isNote(record) && record.voice && !(await store.getAudio(record.id))) {
      withoutRecording++
    }
  }
  const tookFile = records.length - plan.added.length
  return {
    added: plan.added.length,
    skipped: plan.identical.length,
    conflicts: plan.conflicts.length,
    keptMine: plan.conflicts.length - tookFile,
    tookFile,
    withoutRecording,
  }
}

/**
 * JSON with keys in a fixed order and undefined members dropped, so two
 * records compare equal exactly when they hold the same data, whatever the
 * order their keys were written in.
 */
export function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) out[key] = sortKeys(value[key])
  }
  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}

function truncate(text: string | undefined, max = 200): string {
  if (text === undefined) return 'nothing'
  return text.length > max ? `${text.slice(0, max)}…` : text
}
