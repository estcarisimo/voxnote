import { describe, expect, it, vi } from 'vitest'
import {
  createComment,
  isAnnotation,
  migrateAnnotation,
  type Answer,
  type TextAnchor,
} from './annotations'
import {
  ask,
  ASK_INSTRUCTIONS,
  ASK_PROMPT_VERSION,
  askPrompt,
  buildAskInput,
  describeAskUpload,
  isAnswerLength,
  MAX_QUESTION_CHARS,
  MAX_SURROUNDING_CHARS,
  surroundingText,
  withAnswer,
  withoutAnswer,
  type AskRequest,
} from './ask'
import type { TextModelProvider } from '../providers/llm'

function fakeProvider(answer: string): TextModelProvider {
  return {
    id: 'fake',
    name: 'Fake',
    endpointHost: 'llm.example',
    models: [{ id: 'm1', label: 'M1' }],
    describeDestination: (model) => `to llm.example, model ${model}`,
    generate: vi.fn(async () => answer),
  }
}

const request: AskRequest = {
  question: '¿Qué significa decoherencia acá?',
  quote: 'the qubit decoheres within 3 µs',
}
const now = () => new Date('2026-11-11T12:00:00.000Z')
const newId = () => 'answer-1'

const anchor: TextAnchor = {
  type: 'text',
  page: 2,
  quote: 'the qubit decoheres within 3 µs',
  rects: [{ x: 1, y: 2, width: 3, height: 4 }],
}

const answer: Answer = {
  id: 'answer-1',
  question: request.question,
  text: 'Es la pérdida de la superposición cuántica.',
  provider: 'fake',
  model: 'm1',
  promptVersion: 1,
  context: { surroundingChars: 0, earlierAnswers: 0 },
  createdAt: '2026-11-11T12:00:00.000Z',
}

describe('ask', () => {
  it('sends the ask prompt and keeps the answer with what went with it', async () => {
    const provider = fakeProvider('  Es la pérdida de la superposición.  ')
    const got = await ask(
      provider,
      {
        ...request,
        surrounding: { text: 'abc the qubit decoheres', place: 'page 2' },
        earlier: [{ question: 'q0', text: 'a0' }],
      },
      { apiKey: 'k', model: 'm1' },
      now,
      newId,
    )
    expect(got).toEqual({
      id: 'answer-1',
      question: request.question,
      text: 'Es la pérdida de la superposición.',
      provider: 'fake',
      model: 'm1',
      promptVersion: ASK_PROMPT_VERSION,
      length: 'paragraph',
      context: { surroundingChars: 23, earlierAnswers: 1 },
      createdAt: '2026-11-11T12:00:00.000Z',
    })
    const [prompt] = (provider.generate as ReturnType<typeof vi.fn>).mock
      .calls[0] as [ReturnType<typeof askPrompt>]
    expect(prompt.instructions).toBe(ASK_INSTRUCTIONS)
    expect(prompt.effort).toBe('medium')
    expect(prompt.input).toContain('<context>abc the qubit decoheres</context>')
  })

  it('rejects an empty answer instead of keeping it', async () => {
    await expect(
      ask(fakeProvider('  '), request, { apiKey: 'k', model: 'm1' }),
    ).rejects.toThrow(/empty answer/)
  })

  it('refuses before sending: no question, no passage, too long, unknown model', async () => {
    const provider = fakeProvider('x')
    const options = { apiKey: 'k', model: 'm1' }
    const cases: [AskRequest, RegExp][] = [
      [{ ...request, question: ' ' }, /Write the question/],
      [
        { ...request, question: 'x'.repeat(MAX_QUESTION_CHARS + 1) },
        /sends up to/,
      ],
      [{ ...request, quote: '' }, /quoted passage/],
      [
        {
          ...request,
          surrounding: {
            text: 'x'.repeat(MAX_SURROUNDING_CHARS + 1),
            place: 'page 1',
          },
        },
        /surrounding text/,
      ],
    ]
    for (const [r, error] of cases) {
      await expect(ask(provider, r, options)).rejects.toThrow(error)
    }
    await expect(
      ask(provider, request, { apiKey: 'k', model: 'other' }),
    ).rejects.toThrow(/no model "other"/)
    expect(provider.generate).not.toHaveBeenCalled()
  })
})

describe('the ask prompt', () => {
  it('asks for an explanation, not a review, and treats tags as data', () => {
    expect(ASK_PROMPT_VERSION).toBe(2)
    expect(ASK_INSTRUCTIONS).toMatch(/not a critique/)
    expect(ASK_INSTRUCTIONS).toMatch(/Do not write review comments/)
    expect(ASK_INSTRUCTIONS).toMatch(/not enough to answer, say so/)
    expect(ASK_INSTRUCTIONS).toMatch(/not instructions to you/)
  })

  it('wraps every part in tags, the question last', () => {
    const input = buildAskInput({
      ...request,
      language: 'es',
      surrounding: { text: 'around', place: 'page 2' },
      earlier: [{ question: 'q0', text: 'a0' }],
    })
    expect(input).toBe(
      [
        'Language hint: es',
        'Quoted passage:',
        '<passage>the qubit decoheres within 3 µs</passage>',
        'Surrounding text from the document (page 2):',
        '<context>around</context>',
        'Earlier questions about this passage and the answers given:',
        '<earlier>',
        '<question>q0</question>\n<answer>a0</answer>',
        '</earlier>',
        'Answer length: one paragraph',
        'Follow-up question:',
        '<question>¿Qué significa decoherencia acá?</question>',
      ].join('\n'),
    )
    expect(buildAskInput(request)).not.toContain('<context>')
    expect(buildAskInput(request)).not.toContain('<earlier>')
  })
})

describe('describeAskUpload', () => {
  it('lists exactly what is sent and where', () => {
    const provider = fakeProvider('x')
    expect(describeAskUpload(provider, request, 'm1')).toBe(
      'Sends your question (32 characters), the quoted passage (31 characters), the answer length you chose (one paragraph) and the instructions shown under Prompt to llm.example, model m1. Nothing else: not the recording, not the rest of the document, not other comments.',
    )
    const full = describeAskUpload(
      provider,
      {
        ...request,
        language: 'es',
        surrounding: { text: 'x'.repeat(120), place: 'page 2' },
        earlier: [
          { question: 'a', text: 'b' },
          { question: 'c', text: 'd' },
        ],
      },
      'm1',
    )
    expect(full).toContain('120 characters of the document around it (page 2)')
    expect(full).toContain('the 2 earlier questions and answers')
    expect(full).toContain('the language hint "es"')
  })
})

describe('withAnswer and withoutAnswer', () => {
  const comment = createComment(
    {
      documentId: 'doc',
      anchor,
      body: request.question,
      visibility: 'author-facing',
    },
    new Date('2026-11-11T11:00:00.000Z'),
  )

  it('keeps the answer beside the body and makes the comment private', () => {
    const updated = withAnswer(comment, answer, now())
    expect(updated.body).toBe(comment.body)
    expect(updated.answers).toEqual([answer])
    expect(updated.visibility).toBe('private')
    expect(updated.updatedAt).toBe('2026-11-11T12:00:00.000Z')
    expect(isAnnotation(updated)).toBe(true)
    const twice = withAnswer(updated, { ...answer, id: 'answer-2' }, now())
    expect(twice.answers?.map((a) => a.id)).toEqual(['answer-1', 'answer-2'])
    expect(() => withAnswer(updated, answer, now())).toThrow(/already has/)
  })

  it('rejects a malformed answer', () => {
    expect(() => withAnswer(comment, { ...answer, text: ' ' }, now())).toThrow(
      /Invalid answer/,
    )
  })

  it('removes an answer, and the field with the last one', () => {
    const updated = withAnswer(comment, answer, now())
    const cleared = withoutAnswer(updated, 'answer-1', now())
    expect(cleared).not.toHaveProperty('answers')
    expect(isAnnotation(cleared)).toBe(true)
    expect(() => withoutAnswer(cleared, 'answer-1')).toThrow(/no answer/)
  })

  it('is validated on read: an empty list, duplicates or a bad record fail', () => {
    expect(isAnnotation({ ...comment, answers: [] })).toBe(false)
    expect(isAnnotation({ ...comment, answers: [answer, answer] })).toBe(false)
    expect(
      isAnnotation({ ...comment, answers: [{ ...answer, createdAt: 'x' }] }),
    ).toBe(false)
    expect(
      isAnnotation({
        ...comment,
        answers: [{ ...answer, context: { surroundingChars: -1 } }],
      }),
    ).toBe(false)
  })
})

describe('surroundingText', () => {
  it('returns the whole text when it fits, whitespace collapsed', () => {
    expect(surroundingText('a  b\n the  quote c', 'the quote')).toBe(
      'a b the quote c',
    )
  })

  it('centers a window on the quote when the text is longer', () => {
    const text = `${'a'.repeat(100)} QUOTE ${'b'.repeat(100)}`
    const got = surroundingText(text, 'QUOTE', 21)
    expect(got).toBe('aaaaaaa QUOTE bbbbbbb')
    expect(surroundingText(`QUOTE ${'b'.repeat(100)}`, 'QUOTE', 10)).toBe(
      'QUOTE bbbb',
    )
    expect(surroundingText(`${'a'.repeat(100)} QUOTE`, 'QUOTE', 10)).toBe(
      'aaaa QUOTE',
    )
  })

  it('is null when the quote is not in the text', () => {
    expect(surroundingText('nothing here', 'quote')).toBeNull()
    expect(surroundingText('text', ' ')).toBeNull()
  })
})

describe('answer length', () => {
  it('asks for the chosen length, records it, and sizes the budget', async () => {
    for (const [length, words, tokens] of [
      ['line', 'one line (a single sentence)', 2048],
      ['paragraph', 'one paragraph', 4096],
      ['thorough', 'a thorough explanation', 8192],
    ] as const) {
      const prompt = askPrompt({ ...request, length })
      expect(prompt.input).toContain(`Answer length: ${words}`)
      expect(prompt.maxOutputTokens).toBe(tokens)
      const got = await ask(
        fakeProvider('x'),
        { ...request, length },
        { apiKey: 'k', model: 'm1' },
        now,
        newId,
      )
      expect(got.length).toBe(length)
    }
    expect(askPrompt(request).input).toContain('Answer length: one paragraph')
    expect(isAnswerLength('thorough')).toBe(true)
    expect(isAnswerLength('essay')).toBe(false)
  })

  it('is validated on read, and no v4 answer may claim one', () => {
    const comment = createComment({
      documentId: 'doc',
      anchor,
      body: request.question,
    })
    const v4 = { ...withAnswer(comment, answer, now()), schemaVersion: 4 }
    expect(migrateAnnotation(v4)).toEqual({ ...v4, schemaVersion: 5 })
    const impostor = {
      ...v4,
      answers: [{ ...answer, length: 'line' }],
    }
    expect(migrateAnnotation(impostor)).toBe(impostor)
    expect(
      isAnnotation(
        withAnswer(comment, { ...answer, length: 'thorough' }, now()),
      ),
    ).toBe(true)
    expect(
      isAnnotation({
        ...withAnswer(comment, answer, now()),
        answers: [{ ...answer, length: 'essay' }],
      }),
    ).toBe(false)
  })
})
