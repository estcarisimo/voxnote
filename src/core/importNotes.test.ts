// @vitest-environment node
// Node, not jsdom: fake-indexeddb needs Node's structuredClone for Blobs.
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import {
  createComment,
  createHighlight,
  createSuggestion,
  withBody,
  type Annotation,
  type TextAnchor,
} from './annotations'
import { exportJson, type ExportDocument } from './exportNotes'
import {
  InvalidNotesFile,
  applyMerge,
  canonical,
  parseNotesFile,
  planMerge,
  recordsToWrite,
} from './importNotes'
import { openAnnotationStore } from './store'

const ID = 'a'.repeat(64)
const DOC: ExportDocument = {
  kind: 'pdf',
  name: 'paper.pdf',
  id: ID,
  size: 48_213,
  pageCount: 3,
}
const NOW = new Date('2026-11-07T12:00:00.000Z')
const T0 = new Date('2026-11-01T09:00:00.000Z')

function textAnchor(page: number, quote: string): TextAnchor {
  return {
    type: 'text',
    page,
    quote,
    rects: [{ x: 10, y: 500, width: 100, height: 12 }],
  }
}

const voice = {
  mimeType: 'audio/webm',
  durationMs: 2_000,
  recordedAt: '2026-11-01T09:00:00.000Z',
  transcript: {
    raw: 'needs a citation',
    provider: 'openai/gpt-4o-transcribe',
    transcribedAt: '2026-11-01T09:00:05.000Z',
  },
}

function sample() {
  return [
    createHighlight(
      { documentId: ID, anchor: textAnchor(1, 'claim'), color: 'green' },
      T0,
    ),
    createComment(
      {
        documentId: ID,
        anchor: textAnchor(2, 'result'),
        body: 'needs a citation',
        voice,
      },
      T0,
    ),
    createSuggestion(
      { documentId: ID, anchor: textAnchor(3, 'colour'), body: 'color' },
      T0,
    ),
  ] as const
}

describe('parseNotesFile', () => {
  it('reads back what exportJson writes (v3)', () => {
    const annotations = sample()
    const file = parseNotesFile(exportJson(DOC, annotations, NOW, '0.4.0'))
    expect(file.schemaVersion).toBe(3)
    expect(file.appVersion).toBe('0.4.0')
    expect(file.exportedAt).toBe('2026-11-07T12:00:00.000Z')
    expect(file.document).toEqual(DOC)
    expect(new Set(file.annotations.map(canonical))).toEqual(
      new Set(annotations.map(canonical)),
    )
  })

  it('reads a v1 file (PDF only, no kind) with schema v1 annotations', () => {
    const [highlight] = sample()
    const { color: _color, ...v1Highlight } = highlight
    const file = parseNotesFile(
      JSON.stringify({
        schemaVersion: 1,
        exportedAt: '2026-10-29T12:00:00.000Z',
        document: { name: 'paper.pdf', id: ID, pageCount: 3 },
        annotations: [{ ...v1Highlight, schemaVersion: 1 }],
      }),
    )
    expect(file.document).toEqual({
      kind: 'pdf',
      name: 'paper.pdf',
      id: ID,
      size: null,
      pageCount: 3,
    })
    expect(file.appVersion).toBeNull()
    expect(file.annotations).toEqual([{ ...highlight, color: 'yellow' }])
  })

  it('reads a v2 Markdown file', () => {
    const highlight = createHighlight(
      {
        documentId: ID,
        anchor: { type: 'block-text', page: 2, quote: 'q', start: 0, end: 1 },
      },
      T0,
    )
    const file = parseNotesFile(
      JSON.stringify({
        schemaVersion: 2,
        exportedAt: '2026-11-05T12:00:00.000Z',
        document: { kind: 'markdown', name: 'notes.md', id: ID, blockCount: 4 },
        annotations: [highlight],
      }),
    )
    expect(file.document).toMatchObject({ kind: 'markdown', blockCount: 4 })
    expect(file.annotations).toEqual([highlight])
  })

  const valid = () =>
    JSON.parse(exportJson(DOC, sample(), NOW, '0.4.0')) as Record<
      string,
      unknown
    >

  it.each([
    ['not JSON', '{oops', /not valid JSON/],
    ['another JSON file', '{"name":"package"}', /no document or annotations/],
    [
      'a newer format',
      JSON.stringify({ ...valid(), schemaVersion: 4 }),
      /newer VoxNote \(format 4\)/,
    ],
    [
      'a local export time',
      JSON.stringify({ ...valid(), exportedAt: '2026-11-07 12:00' }),
      /not a UTC timestamp/,
    ],
    [
      'a document id that is not a hash',
      JSON.stringify({
        ...valid(),
        document: { ...DOC, id: 'abc' },
      }),
      /not a SHA-256 hash/,
    ],
    [
      'a v3 file without a size',
      JSON.stringify({ ...valid(), document: { ...DOC, size: undefined } }),
      /size is not a byte count/,
    ],
    [
      'a v3 file without the app',
      JSON.stringify({ ...valid(), app: undefined }),
      /which VoxNote wrote it/,
    ],
  ])('refuses %s', (_label, text, message) => {
    expect(() => parseNotesFile(text)).toThrow(InvalidNotesFile)
    expect(() => parseNotesFile(text)).toThrow(message)
  })

  it('refuses the whole file when one annotation is invalid, naming it', () => {
    const file = valid()
    const annotations = file.annotations as Record<string, unknown>[]
    annotations[1] = { ...annotations[1], visibility: 'public' }
    expect(() => parseNotesFile(JSON.stringify(file))).toThrow(
      /Annotation 2 of 3 is not a valid VoxNote annotation/,
    )
  })

  it('refuses an annotation of another document, a duplicate id and a page past the end', () => {
    const other = valid()
    ;(other.annotations as Record<string, unknown>[])[0].documentId =
      'b'.repeat(64)
    expect(() => parseNotesFile(JSON.stringify(other))).toThrow(
      /belongs to document b+, not to a+/,
    )

    const duplicate = valid()
    const list = duplicate.annotations as unknown[]
    list.push(list[0])
    expect(() => parseNotesFile(JSON.stringify(duplicate))).toThrow(
      /appears twice/,
    )

    const past = valid()
    ;(past.document as Record<string, unknown>).pageCount = 1
    expect(() => parseNotesFile(JSON.stringify(past))).toThrow(
      /points at page 2, but the document has 1/,
    )
  })
})

describe('planMerge', () => {
  it('sorts the file into added, identical and conflicting records', () => {
    const [highlight, comment, suggestion] = sample()
    const edited = withBody(comment, 'edited here', new Date(T0.getTime() + 1))
    // Same data, keys in another order: still identical.
    const reordered = Object.fromEntries(
      Object.entries(highlight).reverse(),
    ) as Annotation
    expect(Object.keys(reordered)).not.toEqual(Object.keys(highlight))
    const plan = planMerge(
      [reordered, edited],
      [highlight, comment, suggestion],
    )
    expect(plan.added).toEqual([suggestion])
    expect(plan.identical).toEqual([highlight])
    expect(plan.conflicts).toEqual([{ mine: edited, theirs: comment }])
  })

  it('needs a choice for every conflict', () => {
    const [, comment] = sample()
    const plan = planMerge([withBody(comment, 'mine')], [comment])
    expect(() => recordsToWrite(plan, {})).toThrow(/No choice/)
    expect(recordsToWrite(plan, { [comment.id]: 'mine' })).toEqual([])
    expect(recordsToWrite(plan, { [comment.id]: 'theirs' })).toEqual([comment])
  })
})

describe('applyMerge', () => {
  const label = { name: 'paper.pdf', kind: 'pdf' } as const

  it('round-trips: export, clear, import, and the annotations are back', async () => {
    const annotations = sample()
    const text = exportJson(DOC, annotations, NOW, '0.4.0')
    // A fresh browser: empty database.
    const store = await openAnnotationStore('test', new IDBFactory())
    const file = parseNotesFile(text)
    const plan = planMerge(await store.list(ID), file.annotations)
    const summary = await applyMerge(store, plan, {}, label)
    expect(summary).toEqual({
      added: 3,
      skipped: 0,
      conflicts: 0,
      keptMine: 0,
      tookFile: 0,
      withoutRecording: 1,
    })
    const restored = await store.list(ID)
    expect(new Set(restored.map(canonical))).toEqual(
      new Set(annotations.map(canonical)),
    )
    expect(await store.listDocuments()).toMatchObject([
      { id: ID, name: 'paper.pdf', count: 3 },
    ])

    // Importing the same file again changes nothing.
    const again = planMerge(await store.list(ID), file.annotations)
    expect(await applyMerge(store, again, {}, label)).toMatchObject({
      added: 0,
      skipped: 3,
    })
    store.close()
  })

  it('applies the chosen side of each conflict and keeps local audio', async () => {
    const [, comment, suggestion] = sample()
    const store = await openAnnotationStore('test', new IDBFactory())
    const mineComment = withBody(comment, 'local edit')
    const mineSuggestion = withBody(suggestion, 'colors')
    await store.put(mineComment, {
      id: comment.id,
      blob: new Blob(['opus'], { type: 'audio/webm' }),
    })
    await store.put(mineSuggestion)
    const plan = planMerge(await store.list(ID), [comment, suggestion])
    const summary = await applyMerge(
      store,
      plan,
      { [comment.id]: 'theirs', [suggestion.id]: 'mine' },
      label,
    )
    expect(summary).toEqual({
      added: 0,
      skipped: 0,
      conflicts: 2,
      keptMine: 1,
      tookFile: 1,
      withoutRecording: 0,
    })
    const stored = await store.list(ID)
    expect(stored.find((a) => a.id === comment.id)).toEqual(comment)
    expect(stored.find((a) => a.id === suggestion.id)).toEqual(mineSuggestion)
    expect((await store.getAudio(comment.id))?.id).toBe(comment.id)
    store.close()
  })
})
