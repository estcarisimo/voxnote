import { describe, expect, it } from 'vitest'
import {
  createComment,
  createSuggestion,
  isAnnotation,
  withBody,
  type CleanUp,
  type TextAnchor,
  type VoiceNote,
} from './annotations'
import {
  assertCleanUpAcceptable,
  checkProposal,
  CLEAN_UP_LENGTH_LIMITS,
  cleanUpForDraft,
  cleanUpLabel,
  withCleanUp,
  type CleanUpProposal,
} from './cleanUp'

const anchor: TextAnchor = {
  type: 'text',
  page: 1,
  quote: 'the qubit decoheres',
  rects: [{ x: 0, y: 0, width: 10, height: 10 }],
}

const RAW = 'um so the the cubit claim here is uh not supported'

const voice: VoiceNote = {
  mimeType: 'audio/webm',
  durationMs: 2000,
  recordedAt: '2026-10-29T10:00:00.000Z',
  transcript: {
    raw: RAW,
    provider: 'openai/gpt-transcribe',
    transcribedAt: '2026-10-29T10:00:05.000Z',
  },
}

const record: CleanUp = {
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  createdAt: '2026-10-29T10:01:00.000Z',
  promptVersion: 1,
}

const proposal: CleanUpProposal = {
  text: 'The qubit claim here is not supported.',
  cleanUp: record,
}

const now = new Date('2026-10-29T10:02:00Z')

function dictatedComment() {
  return createComment(
    { documentId: 'doc', anchor, body: RAW, voice },
    new Date('2026-10-29T10:00:06Z'),
  )
}

describe('assertCleanUpAcceptable', () => {
  it('accepts a plausible clean-up', () => {
    expect(() => assertCleanUpAcceptable(RAW, proposal.text)).not.toThrow()
  })

  it('rejects an empty raw transcript or an empty result', () => {
    expect(() => assertCleanUpAcceptable('  ', 'Text.')).toThrow(
      /no raw transcript/,
    )
    expect(() => assertCleanUpAcceptable(RAW, '')).toThrow(/empty clean-up/)
    expect(() => assertCleanUpAcceptable(RAW, ' \n ')).toThrow(/empty clean-up/)
  })

  it('rejects a result identical to the raw text, whitespace aside', () => {
    expect(() => assertCleanUpAcceptable(RAW, RAW)).toThrow(/unchanged/)
    expect(() =>
      assertCleanUpAcceptable(RAW, `  ${RAW.replace(/ /g, '  ')}\n`),
    ).toThrow(/unchanged/)
  })

  it('rejects a result much longer than the raw text', () => {
    const raw = 'x'.repeat(100)
    // 1.5 × 100 = 150 passes; 151 is past the ratio and the slack.
    expect(() => assertCleanUpAcceptable(raw, 'y'.repeat(150))).not.toThrow()
    expect(() => assertCleanUpAcceptable(raw, 'y'.repeat(151))).toThrow(
      /151 characters for a 100-character transcript \(151%\).*rejected/,
    )
  })

  it('rejects a result much shorter than the raw text', () => {
    const raw = 'x'.repeat(100)
    expect(() => assertCleanUpAcceptable(raw, 'y'.repeat(50))).not.toThrow()
    expect(() => assertCleanUpAcceptable(raw, 'y'.repeat(49))).toThrow(
      /49 characters for a 100-character transcript/,
    )
  })

  it('lets short notes move within the absolute slack whatever the ratio', () => {
    const { slackChars } = CLEAN_UP_LENGTH_LIMITS
    expect(slackChars).toBe(20)
    // "um, uh, typo" (12) → "Typo." (5): ratio 0.42, but only 7 apart.
    expect(() => assertCleanUpAcceptable('um, uh, typo', 'Typo.')).not.toThrow()
    // 10 → 30 is exactly the slack; 31 is past it and past the ratio.
    const raw = 'a'.repeat(10)
    expect(() => assertCleanUpAcceptable(raw, 'b'.repeat(30))).not.toThrow()
    expect(() => assertCleanUpAcceptable(raw, 'b'.repeat(31))).toThrow(
      /rejected/,
    )
  })

  it('documents the thresholds it enforces', () => {
    expect(CLEAN_UP_LENGTH_LIMITS).toEqual({
      minRatio: 0.5,
      maxRatio: 1.5,
      slackChars: 20,
    })
  })
})

describe('checkProposal', () => {
  it('rejects a malformed record', () => {
    expect(() =>
      checkProposal(RAW, {
        ...proposal,
        cleanUp: { ...record, createdAt: '2026-10-29 10:01' },
      }),
    ).toThrow(/Invalid clean-up record/)
    expect(() =>
      checkProposal(RAW, { ...proposal, cleanUp: { ...record, model: '' } }),
    ).toThrow(/Invalid clean-up record/)
  })

  it('returns a valid proposal unchanged', () => {
    expect(checkProposal(RAW, proposal)).toBe(proposal)
  })
})

describe('withCleanUp', () => {
  it('puts the text in the body, records it, and leaves the raw transcript untouched', () => {
    const before = dictatedComment()
    const after = withCleanUp(before, proposal, now)
    expect(after.body).toBe(proposal.text)
    expect(after.cleanUp).toEqual(record)
    expect(after.voice).toEqual(before.voice)
    expect(after.voice?.transcript?.raw).toBe(RAW)
    expect(after.updatedAt).toBe(now.toISOString())
    expect(before.body).toBe(RAW)
    expect(before.cleanUp).toBeUndefined()
    expect(isAnnotation(after)).toBe(true)
  })

  it('refuses a note without a raw transcript', () => {
    const typed = createComment({ documentId: 'doc', anchor, body: 'typed' })
    expect(() => withCleanUp(typed, proposal, now)).toThrow(/no raw transcript/)
    const untranscribed = createComment({
      documentId: 'doc',
      anchor,
      body: '',
      voice: { ...voice, transcript: undefined },
    })
    expect(() => withCleanUp(untranscribed, proposal, now)).toThrow(
      /no raw transcript/,
    )
  })

  it('refuses a proposal that fails the checks', () => {
    expect(() =>
      withCleanUp(dictatedComment(), { ...proposal, text: RAW }, now),
    ).toThrow(/unchanged/)
    expect(() =>
      withCleanUp(dictatedComment(), { ...proposal, text: '' }, now),
    ).toThrow(/empty/)
  })

  it('keeps the suggestion rule: the clean-up must not equal the original', () => {
    const suggestion = createSuggestion({
      documentId: 'doc',
      anchor,
      body: '',
      voice: {
        ...voice,
        transcript: { ...voice.transcript!, raw: 'the cubit de coheres' },
      },
    })
    expect(() =>
      withCleanUp(
        suggestion,
        { ...proposal, text: 'the qubit decoheres' },
        now,
      ),
    ).toThrow(/equals the original/)
    const ok = withCleanUp(
      suggestion,
      { ...proposal, text: 'The qubit decoheres quickly.' },
      now,
    )
    expect(ok.body).toBe('The qubit decoheres quickly.')
  })

  it('replaces an earlier clean-up and clears its edited flag', () => {
    const edited = withBody(
      withCleanUp(dictatedComment(), proposal, now),
      'The qubit claim is not supported.',
      now,
    )
    expect(edited.cleanUp?.editedAfter).toBe(true)
    const again = withCleanUp(
      edited,
      {
        text: 'The qubit claim here is unsupported.',
        cleanUp: { ...record, model: 'claude-haiku-5-5', editedAfter: true },
      },
      now,
    )
    expect(again.cleanUp).toEqual({ ...record, model: 'claude-haiku-5-5' })
  })
})

describe('withBody after a clean-up', () => {
  it('flags the record as edited when the text changes, not otherwise', () => {
    const cleaned = withCleanUp(dictatedComment(), proposal, now)
    expect(withBody(cleaned, cleaned.body, now).cleanUp?.editedAfter).toBe(
      undefined,
    )
    expect(withBody(cleaned, 'Changed.', now).cleanUp).toEqual({
      ...record,
      editedAfter: true,
    })
    // Clearing a dictated comment's body leaves nothing cleaned up to label.
    const cleared = withBody(cleaned, ' ', now)
    expect(cleared.cleanUp).toBeUndefined()
    expect(isAnnotation(cleared)).toBe(true)
  })
})

describe('cleanUpForDraft', () => {
  it('marks a draft edited after accepting, and not when untouched', () => {
    expect(cleanUpForDraft(proposal, proposal.text)).toEqual(record)
    expect(cleanUpForDraft(proposal, `${proposal.text} More.`)).toEqual({
      ...record,
      editedAfter: true,
    })
  })
})

describe('cleanUpLabel', () => {
  it('names provider and model', () => {
    expect(cleanUpLabel(record)).toBe('anthropic/claude-opus-5-5')
  })
})
