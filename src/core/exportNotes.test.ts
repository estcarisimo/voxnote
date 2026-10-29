import { describe, expect, it } from 'vitest'
import {
  createComment,
  createHighlight,
  createSuggestion,
  isAnnotation,
  withTranscript,
  type Annotation,
  type TextAnchor,
} from './annotations'
import {
  NOTES_EXPORT_SCHEMA_VERSION,
  exportJson,
  exportMarkdown,
  type ExportDocument,
} from './exportNotes'

const DOC: ExportDocument = { name: 'paper.pdf', id: 'abc123', pageCount: 3 }
const NOW = new Date('2026-10-29T12:00:00.000Z')
const T0 = new Date('2026-10-01T09:00:00.000Z')
const T1 = new Date('2026-10-01T09:05:00.000Z')

function textAnchor(page: number, quote: string, top = 500): TextAnchor {
  return {
    type: 'text',
    page,
    quote,
    rects: [{ x: 10, y: top - 12, width: 100, height: 12 }],
  }
}

const voice = {
  mimeType: 'audio/webm',
  durationMs: 12_345,
  recordedAt: '2026-10-01T09:00:00.000Z',
}

const transcript = {
  raw: 'um this claim needs a citation',
  provider: 'openai/gpt-4o-transcribe',
  language: 'en',
  transcribedAt: '2026-10-01T09:01:00.000Z',
}

describe('exportMarkdown', () => {
  it('writes a header with the file name, UTC export time and document id', () => {
    const md = exportMarkdown(DOC, [], NOW)
    expect(md).toBe(
      [
        '# VoxNote review: paper.pdf',
        '',
        '- Exported: 2026-10-29T12:00:00.000Z (UTC)',
        '- Document id (SHA-256): `abc123`',
        '- Pages: 3',
        '- Annotations: 0',
        '',
        'No annotations.',
        '',
      ].join('\n'),
    )
  })

  it('renders text and region highlights under their page', () => {
    const text = createHighlight(
      { documentId: DOC.id, anchor: textAnchor(1, 'the key result') },
      T0,
    )
    const region = createHighlight(
      {
        documentId: DOC.id,
        anchor: {
          type: 'region',
          page: 2,
          rect: { x: 0, y: 0, width: 50, height: 50 },
        },
        visibility: 'author-facing',
      },
      T0,
    )
    const md = exportMarkdown(DOC, [region, text], NOW)
    expect(md).toContain(
      [
        '## Page 1',
        '',
        '- **Highlight** (private), created 2026-10-01T09:00:00.000Z (UTC)',
        '  - Passage:',
        '    > the key result',
        '',
        '## Page 2',
        '',
        '- **Highlight** (author-facing), created 2026-10-01T09:00:00.000Z (UTC)',
        '  - Region on page 2',
        '',
      ].join('\n'),
    )
    expect(md).not.toContain('## Page 3')
  })

  it('shows a voice comment with its duration and the raw transcript, marked raw', () => {
    const dictated = createComment(
      { documentId: DOC.id, anchor: textAnchor(1, 'Table 2'), body: '', voice },
      T0,
    )
    const transcribed = withTranscript(dictated, transcript, T1)
    const edited = { ...transcribed, body: 'This claim needs a citation.' }
    const md = exportMarkdown(DOC, [edited], NOW)
    expect(md).toContain(
      [
        '- **Comment** (private), created 2026-10-01T09:00:00.000Z (UTC)',
        '  - Passage:',
        '    > Table 2',
        '  - Comment:',
        '    > This claim needs a citation.',
        '  - Voice note: 12.3 s, recorded 2026-10-01T09:00:00.000Z (UTC)',
        '  - Raw transcript (unedited, openai/gpt-4o-transcribe, language en, 2026-10-01T09:01:00.000Z UTC):',
        '    > um this claim needs a citation',
      ].join('\n'),
    )
  })

  it('says when a voice comment has not been transcribed', () => {
    const comment = createComment(
      {
        documentId: DOC.id,
        anchor: textAnchor(1, 'x'),
        body: '',
        voice: { ...voice, durationMs: 75_000 },
      },
      T0,
    )
    const md = exportMarkdown(DOC, [comment], NOW)
    expect(md).toContain('  - Comment: recorded by voice; not transcribed yet.')
    expect(md).toContain('  - Voice note: 1 min 15 s')
    expect(md).toContain('  - Transcript: not transcribed yet.')
  })

  it('keeps multi-line bodies inside the item as quoted lines', () => {
    const comment = createComment(
      {
        documentId: DOC.id,
        anchor: textAnchor(1, 'x'),
        body: 'First line\n\n## not a heading',
      },
      T0,
    )
    const md = exportMarkdown(DOC, [comment], NOW)
    expect(md).toContain(
      ['    > First line', '    >', '    > ## not a heading'].join('\n'),
    )
  })

  it('renders typed and untranscribed dictated suggestions', () => {
    const typed = createSuggestion(
      {
        documentId: DOC.id,
        anchor: textAnchor(1, 'teh results', 500),
        body: 'the results',
      },
      T0,
    )
    const dictated = createSuggestion(
      {
        documentId: DOC.id,
        anchor: textAnchor(1, 'was shown', 400),
        body: '',
        voice,
      },
      T0,
    )
    const md = exportMarkdown(DOC, [dictated, typed], NOW)
    expect(md).toContain(
      [
        '- **Suggestion** (private), created 2026-10-01T09:00:00.000Z (UTC)',
        '  - Original:',
        '    > teh results',
        '  - Replacement:',
        '    > the results',
        '- **Suggestion** (private), created 2026-10-01T09:00:00.000Z (UTC)',
        '  - Original:',
        '    > was shown',
        '  - Replacement: recorded by voice; not transcribed yet.',
        '  - Voice note: 12.3 s, recorded 2026-10-01T09:00:00.000Z (UTC)',
        '  - Transcript: not transcribed yet.',
      ].join('\n'),
    )
  })

  it('keeps non-Latin text intact', () => {
    const comment = createComment(
      {
        documentId: DOC.id,
        anchor: textAnchor(1, 'Δx → 0, 日本語の引用'),
        body: 'Нужна ссылка 🙂',
      },
      T0,
    )
    const md = exportMarkdown({ ...DOC, name: 'статья.pdf' }, [comment], NOW)
    expect(md).toContain('# VoxNote review: статья.pdf')
    expect(md).toContain('    > Δx → 0, 日本語の引用')
    expect(md).toContain('    > Нужна ссылка 🙂')
  })

  it('escapes Markdown syntax in the file name', () => {
    const md = exportMarkdown({ ...DOC, name: '*draft*_v2#.pdf' }, [], NOW)
    expect(md.split('\n')[0]).toBe('# VoxNote review: \\*draft\\*\\_v2\\#.pdf')
  })

  it('labels a cleaned-up body as such and keeps the raw transcript labeled raw', () => {
    const cleanUp = {
      provider: 'xai',
      model: 'grok-4.7',
      createdAt: '2026-10-01T09:02:00.000Z',
      promptVersion: 1,
    }
    const comment = createComment(
      {
        documentId: DOC.id,
        anchor: textAnchor(1, 'the claim'),
        body: 'This claim needs a citation.',
        voice: { ...voice, transcript },
        cleanUp,
      },
      T0,
    )
    const suggestion = createSuggestion(
      {
        documentId: DOC.id,
        anchor: textAnchor(1, 'the claim', 400),
        body: 'This claim, with a citation.',
        voice: { ...voice, transcript },
        cleanUp: { ...cleanUp, editedAfter: true },
      },
      T1,
    )
    const md = exportMarkdown(DOC, [comment, suggestion], NOW)
    expect(md).toContain(
      [
        '  - Comment (cleaned up with xai/grok-4.7, 2026-10-01T09:02:00.000Z UTC, prompt v1; the raw transcript is below):',
        '    > This claim needs a citation.',
      ].join('\n'),
    )
    expect(md).toContain(
      '  - Replacement (cleaned up with xai/grok-4.7, 2026-10-01T09:02:00.000Z UTC, prompt v1, then edited by the reviewer; the raw transcript is below):',
    )
    expect(md).toContain(
      [
        '  - Raw transcript (unedited, openai/gpt-4o-transcribe, language en, 2026-10-01T09:01:00.000Z UTC):',
        '    > um this claim needs a citation',
      ].join('\n'),
    )
    // A body never cleaned up carries no such label.
    const plain = createComment(
      { documentId: DOC.id, anchor: textAnchor(2, 'x'), body: 'Typed.' },
      T0,
    )
    expect(exportMarkdown(DOC, [plain], NOW)).not.toContain('cleaned up')
  })

  it('carries the clean-up record in the JSON export', () => {
    const comment = createComment(
      {
        documentId: DOC.id,
        anchor: textAnchor(1, 'the claim'),
        body: 'This claim needs a citation.',
        voice: { ...voice, transcript },
        cleanUp: {
          provider: 'openai',
          model: 'gpt-6.1-terra',
          createdAt: '2026-10-01T09:02:00.000Z',
          promptVersion: 1,
        },
      },
      T0,
    )
    const parsed = JSON.parse(exportJson(DOC, [comment], NOW)) as {
      annotations: Annotation[]
    }
    expect(parsed.annotations[0]).toEqual(comment)
    expect(isAnnotation(parsed.annotations[0])).toBe(true)
  })
})

describe('ordering', () => {
  it('sorts by page, then top to bottom, then createdAt', () => {
    const p2 = createHighlight(
      { documentId: DOC.id, anchor: textAnchor(2, 'p2') },
      T0,
    )
    const lower = createHighlight(
      { documentId: DOC.id, anchor: textAnchor(1, 'lower', 300) },
      T0,
    )
    const upperLate = createHighlight(
      { documentId: DOC.id, anchor: textAnchor(1, 'upper late', 700) },
      T1,
    )
    const upperEarly = createHighlight(
      { documentId: DOC.id, anchor: textAnchor(1, 'upper early', 700) },
      T0,
    )
    const region = createHighlight(
      {
        documentId: DOC.id,
        anchor: {
          type: 'region',
          page: 1,
          rect: { x: 0, y: 400, width: 10, height: 100 },
        },
      },
      T0,
    )
    const shuffled = [p2, lower, upperLate, region, upperEarly]
    const expected = ['upper early', 'upper late', 'region', 'lower', 'p2']

    const md = exportMarkdown(DOC, shuffled, NOW)
    const order = md
      .split('\n')
      .filter((l) => l.startsWith('    > ') || l.startsWith('  - Region'))
      .map((l) => (l.startsWith('  - Region') ? 'region' : l.slice(6)))
    expect(order).toEqual(expected)

    const json = JSON.parse(exportJson(DOC, shuffled, NOW)) as {
      annotations: Annotation[]
    }
    expect(json.annotations.map((a) => a.id)).toEqual([
      upperEarly.id,
      upperLate.id,
      region.id,
      lower.id,
      p2.id,
    ])
    // Same input in another order gives byte-identical output.
    expect(exportJson(DOC, [...shuffled].reverse(), NOW)).toBe(
      exportJson(DOC, shuffled, NOW),
    )
  })
})

describe('validation', () => {
  it('rejects an annotation past the last page', () => {
    const late = createHighlight(
      { documentId: DOC.id, anchor: textAnchor(4, 'nowhere') },
      T0,
    )
    const message = `Annotation ${late.id} points at page 4, but the document has 3`
    expect(() => exportMarkdown(DOC, [late], NOW)).toThrow(message)
    expect(() => exportJson(DOC, [late], NOW)).toThrow(message)
  })

  it('rejects an annotation from another document', () => {
    const other = createHighlight(
      { documentId: 'other', anchor: textAnchor(1, 'x') },
      T0,
    )
    expect(() => exportMarkdown(DOC, [other], NOW)).toThrow(
      /belongs to document other/,
    )
  })

  it('rejects a malformed annotation and a bad page count', () => {
    const broken = {
      ...createHighlight({ documentId: DOC.id, anchor: textAnchor(1, 'x') }),
      createdAt: '2026-10-01 09:00',
    }
    expect(() => exportJson(DOC, [broken], NOW)).toThrow(/Invalid annotation/)
    expect(() => exportJson({ ...DOC, pageCount: 0 }, [], NOW)).toThrow(
      'Invalid page count: 0',
    )
  })
})

describe('exportJson', () => {
  it('round-trips every annotation through isAnnotation, without audio', () => {
    const highlight = createHighlight(
      {
        documentId: DOC.id,
        anchor: {
          ...textAnchor(1, 'quoted'),
          textOffsets: { start: 3, end: 9 },
        },
      },
      T0,
    )
    const comment = withTranscript(
      createComment(
        { documentId: DOC.id, anchor: textAnchor(2, 'ü'), body: '', voice },
        T0,
      ),
      transcript,
      T1,
    )
    const suggestion = createSuggestion(
      {
        documentId: DOC.id,
        anchor: textAnchor(3, 'colour'),
        body: 'color',
      },
      T0,
    )
    const annotations = [highlight, comment, suggestion]

    const text = exportJson(DOC, annotations, NOW)
    const parsed = JSON.parse(text) as Record<string, unknown>

    expect(parsed.schemaVersion).toBe(NOTES_EXPORT_SCHEMA_VERSION)
    expect(parsed.exportedAt).toBe('2026-10-29T12:00:00.000Z')
    expect(parsed.document).toEqual(DOC)
    const restored = parsed.annotations as unknown[]
    expect(restored.every(isAnnotation)).toBe(true)
    expect(restored).toEqual(annotations)
    expect(text).not.toMatch(/blob|base64/i)
  })

  it('does not copy extra fields from the document input', () => {
    const doc = { ...DOC, bytes: new Uint8Array([1, 2, 3]) }
    const parsed = JSON.parse(exportJson(doc, [], NOW)) as {
      document: unknown
    }
    expect(parsed.document).toEqual(DOC)
  })
})
