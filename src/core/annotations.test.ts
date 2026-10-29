import { describe, expect, it } from 'vitest'
import {
  ANNOTATION_SCHEMA_VERSION,
  createComment,
  createHighlight,
  createSuggestion,
  isAnnotation,
  isCleanUp,
  isVoiceNote,
  migrateAnnotation,
  isAnchor,
  mergeLineRects,
  rectFromCorners,
  unionRects,
  withBody,
  withVisibility,
  withTranscript,
  type Anchor,
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
    expect(isAnnotation({ ...good, schemaVersion: 3 })).toBe(false)
    expect(isAnnotation({ ...good, schemaVersion: 1 })).toBe(false)
    expect(
      isAnnotation({ ...good, createdAt: '2026-01-01T00:00:00+02:00' }),
    ).toBe(false)
    expect(isAnnotation({ ...good, kind: 'sticker' })).toBe(false)
    expect(isAnnotation(null)).toBe(false)
  })
})

describe('createComment / withBody', () => {
  const anchor = {
    type: 'region',
    page: 1,
    rect: rect(0, 0, 10, 10),
  } as const
  const voice = {
    mimeType: 'audio/webm;codecs=opus',
    durationMs: 1500,
    recordedAt: '2026-10-29T12:00:00.000Z',
  }

  it('creates a typed comment', () => {
    const c = createComment({ documentId: 'doc', anchor, body: ' Hola ' })
    expect(c.kind).toBe('comment')
    expect(c.body).toBe(' Hola ')
    expect(c.voice).toBeUndefined()
    expect(isAnnotation(c)).toBe(true)
  })

  it('accepts an empty body when a voice note is attached', () => {
    const c = createComment({ documentId: 'doc', anchor, body: '', voice })
    expect(c.voice).toEqual(voice)
    expect(isAnnotation(c)).toBe(true)
  })

  it('rejects a comment with nothing to say', () => {
    expect(() =>
      createComment({ documentId: 'doc', anchor, body: '   ' }),
    ).toThrow(/needs a body or a voice note/)
  })

  it('rejects a malformed voice note', () => {
    expect(() =>
      createComment({
        documentId: 'doc',
        anchor,
        body: 'x',
        voice: { ...voice, recordedAt: '2026-10-29T12:00:00' },
      }),
    ).toThrow(/Invalid voice note/)
  })

  it('withBody keeps createdAt and bumps updatedAt', () => {
    const c = createComment(
      { documentId: 'doc', anchor, body: 'a' },
      new Date('2026-10-29T12:00:00.000Z'),
    )
    const edited = withBody(c, 'b', new Date('2026-10-29T12:05:00.000Z'))
    expect(edited.body).toBe('b')
    expect(edited.createdAt).toBe('2026-10-29T12:00:00.000Z')
    expect(edited.updatedAt).toBe('2026-10-29T12:05:00.000Z')
    expect(c.body).toBe('a')
    expect(() => withBody(c, '')).toThrow(/needs a body/)
  })

  it('withTranscript keeps the raw text and fills an empty body only', () => {
    const transcript = {
      raw: 'la figura dos no tiene ejes',
      provider: 'openai/gpt-transcribe',
      language: 'es',
      transcribedAt: '2026-10-29T12:01:00.000Z',
    }
    const empty = createComment({ documentId: 'doc', anchor, body: '', voice })
    const filled = withTranscript(
      empty,
      transcript,
      new Date('2026-10-29T12:02:00.000Z'),
    )
    expect(filled.body).toBe(transcript.raw)
    expect(filled.voice?.transcript).toEqual(transcript)
    expect(filled.updatedAt).toBe('2026-10-29T12:02:00.000Z')
    expect(empty.voice?.transcript).toBeUndefined()

    const typed = createComment({
      documentId: 'doc',
      anchor,
      body: 'my own words',
      voice,
    })
    expect(withTranscript(typed, transcript).body).toBe('my own words')
    expect(withTranscript(typed, transcript).voice?.transcript?.raw).toBe(
      transcript.raw,
    )

    const noVoice = createComment({ documentId: 'doc', anchor, body: 'x' })
    expect(() => withTranscript(noVoice, transcript)).toThrow(/no voice note/)
    expect(() =>
      withTranscript(filled, { ...transcript, raw: 'something else' }),
    ).toThrow(/already has a transcript/)
    expect(() =>
      withTranscript(empty, { ...transcript, transcribedAt: 'yesterday' }),
    ).toThrow(/Invalid transcript/)
  })

  it('validates transcripts inside voice notes', () => {
    const transcript = {
      raw: 'hola',
      provider: 'test/model',
      transcribedAt: '2026-10-29T12:01:00.000Z',
    }
    expect(isVoiceNote({ ...voice, transcript })).toBe(true)
    expect(
      isVoiceNote({ ...voice, transcript: { ...transcript, raw: 1 } }),
    ).toBe(false)
    expect(isVoiceNote({ ...voice, durationMs: -1 })).toBe(false)
  })

  it('isAnnotation rejects comments without body or voice and unknown kinds', () => {
    const c = createComment({ documentId: 'doc', anchor, body: 'x' })
    expect(isAnnotation({ ...c, body: '' })).toBe(false)
    expect(isAnnotation({ ...c, body: 3 })).toBe(false)
    expect(isAnnotation({ ...c, kind: 'suggestion' })).toBe(false)
    expect(isAnnotation({ ...c, voice: { mimeType: 'audio/webm' } })).toBe(
      false,
    )
  })
})

describe('createSuggestion', () => {
  const text = {
    type: 'text',
    page: 2,
    quote: 'the the results',
    rects: [rect(0, 0, 10, 10)],
  } as const satisfies Anchor
  const voice = {
    mimeType: 'audio/webm',
    durationMs: 900,
    recordedAt: '2026-10-29T12:00:00.000Z',
  }

  it('records the original and the replacement', () => {
    const s = createSuggestion({
      documentId: 'doc',
      anchor: text,
      body: 'the results',
    })
    expect(s.kind).toBe('suggestion')
    expect(s.original).toBe('the the results')
    expect(s.body).toBe('the results')
    expect(isAnnotation(s)).toBe(true)
  })

  it('refuses a suggestion that changes nothing, or has nothing yet', () => {
    expect(() =>
      createSuggestion({
        documentId: 'doc',
        anchor: text,
        body: ' the the results ',
      }),
    ).toThrow(/must change the text/)
    expect(() =>
      createSuggestion({ documentId: 'doc', anchor: text, body: '' }),
    ).toThrow(/needs replacement text or a voice note/)
    expect(() =>
      createSuggestion({
        documentId: 'doc',
        anchor: { type: 'region', page: 1, rect: rect(0, 0, 1, 1) } as never,
        body: 'x',
      }),
    ).toThrow(/needs selected text/)
  })

  it('accepts an empty replacement with a voice note, and withBody keeps the rule', () => {
    const s = createSuggestion({
      documentId: 'doc',
      anchor: text,
      body: '',
      voice,
    })
    expect(isAnnotation(s)).toBe(true)
    expect(withBody(s, 'the results').body).toBe('the results')
    expect(() => withBody(s, 'the the results')).toThrow(/must change/)
    expect(isAnnotation({ ...s, body: 'the the results' })).toBe(false)
    expect(isAnnotation({ ...s, original: '' })).toBe(false)
  })

  it('withTranscript fills the replacement, unless the dictation repeats the original', () => {
    const s = createSuggestion({
      documentId: 'doc',
      anchor: text,
      body: '',
      voice,
    })
    const dictated = withTranscript(s, {
      raw: 'the results',
      provider: 'p/m',
      transcribedAt: '2026-10-29T12:01:00.000Z',
    })
    expect(dictated.body).toBe('the results')
    expect(dictated.voice?.transcript?.raw).toBe('the results')

    const same = withTranscript(s, {
      raw: 'the the results',
      provider: 'p/m',
      transcribedAt: '2026-10-29T12:01:00.000Z',
    })
    expect(same.body).toBe('')
    expect(same.voice?.transcript?.raw).toBe('the the results')
    expect(isAnnotation(same)).toBe(true)
  })
})

describe('withVisibility', () => {
  it('flips the visibility and bumps updatedAt, leaving the rest alone', () => {
    const h = createHighlight(
      {
        documentId: 'd',
        anchor: {
          type: 'region',
          page: 1,
          rect: { x: 0, y: 0, width: 1, height: 1 },
        },
      },
      new Date('2026-10-29T12:00:00.000Z'),
    )
    expect(h.visibility).toBe('private')
    const shared = withVisibility(
      h,
      'author-facing',
      new Date('2026-10-29T12:05:00.000Z'),
    )
    expect(shared.visibility).toBe('author-facing')
    expect(shared.updatedAt).toBe('2026-10-29T12:05:00.000Z')
    expect(shared.createdAt).toBe(h.createdAt)
    expect(shared.id).toBe(h.id)
    expect(h.visibility).toBe('private')
    expect(() => withVisibility(h, 'public' as unknown as 'private')).toThrow(
      /Unknown visibility/,
    )
  })
})

describe('clean-up records and schema v2', () => {
  const anchor: Anchor = {
    type: 'text',
    page: 1,
    quote: 'passage',
    rects: [rect(0, 0, 10, 10)],
  }
  const voice = {
    mimeType: 'audio/webm',
    durationMs: 1000,
    recordedAt: '2026-10-29T10:00:00.000Z',
    transcript: {
      raw: 'um the claim is uh weak',
      provider: 'openai/gpt-transcribe',
      transcribedAt: '2026-10-29T10:00:01.000Z',
    },
  }
  const cleanUp = {
    provider: 'xai',
    model: 'grok-4.7',
    createdAt: '2026-10-29T10:00:02.000Z',
    promptVersion: 1,
  }

  it('validates the record itself', () => {
    expect(isCleanUp(cleanUp)).toBe(true)
    expect(isCleanUp({ ...cleanUp, editedAfter: true })).toBe(true)
    expect(isCleanUp({ ...cleanUp, provider: '' })).toBe(false)
    expect(isCleanUp({ ...cleanUp, promptVersion: 0 })).toBe(false)
    expect(isCleanUp({ ...cleanUp, promptVersion: 1.5 })).toBe(false)
    expect(
      isCleanUp({ ...cleanUp, createdAt: '2026-10-29T10:00:02+01:00' }),
    ).toBe(false)
    expect(isCleanUp({ ...cleanUp, editedAfter: 'yes' })).toBe(false)
  })

  it('creates a dictated comment with an accepted clean-up', () => {
    const c = createComment({
      documentId: 'doc',
      anchor,
      body: 'The claim is weak.',
      voice,
      cleanUp,
    })
    expect(c.cleanUp).toEqual(cleanUp)
    expect(c.voice?.transcript?.raw).toBe('um the claim is uh weak')
    expect(isAnnotation(c)).toBe(true)
  })

  it('refuses a clean-up record without a transcript or a body', () => {
    expect(() =>
      createComment({ documentId: 'doc', anchor, body: 'Typed.', cleanUp }),
    ).toThrow(/no raw transcript/)
    expect(() =>
      createComment({ documentId: 'doc', anchor, body: ' ', voice, cleanUp }),
    ).toThrow(/needs a body/)
    expect(() =>
      createSuggestion({
        documentId: 'doc',
        anchor: anchor as Extract<Anchor, { type: 'text' }>,
        body: 'New text.',
        cleanUp: { ...cleanUp, model: '' },
        voice,
      }),
    ).toThrow(/Invalid clean-up record/)
  })

  it('isAnnotation rejects a clean-up on a highlight or beside no transcript', () => {
    const h = createHighlight({ documentId: 'doc', anchor })
    expect(isAnnotation({ ...h, cleanUp })).toBe(false)
    const typed = createComment({ documentId: 'doc', anchor, body: 'Typed.' })
    expect(isAnnotation({ ...typed, cleanUp })).toBe(false)
    const dictated = createComment({
      documentId: 'doc',
      anchor,
      body: 'The claim is weak.',
      voice,
    })
    expect(isAnnotation({ ...dictated, cleanUp })).toBe(true)
    expect(
      isAnnotation({ ...dictated, cleanUp: { ...cleanUp, model: 3 } }),
    ).toBe(false)
  })

  it('migrates a v1 record by its version number only', () => {
    const v2 = createComment({ documentId: 'doc', anchor, body: 'x', voice })
    expect(ANNOTATION_SCHEMA_VERSION).toBe(2)
    const v1 = { ...v2, schemaVersion: 1 }
    expect(isAnnotation(v1)).toBe(false)
    const migrated = migrateAnnotation(v1)
    expect(migrated).toEqual(v2)
    expect(isAnnotation(migrated)).toBe(true)
  })

  it('leaves anything else for isAnnotation to reject', () => {
    const v2 = createComment({ documentId: 'doc', anchor, body: 'x', voice })
    expect(migrateAnnotation(v2)).toBe(v2)
    const future = { ...v2, schemaVersion: 3 }
    expect(migrateAnnotation(future)).toBe(future)
    const odd = { ...v2, schemaVersion: 1, cleanUp }
    expect(migrateAnnotation(odd)).toBe(odd)
    expect(migrateAnnotation(null)).toBeNull()
    expect(migrateAnnotation('x')).toBe('x')
  })
})
