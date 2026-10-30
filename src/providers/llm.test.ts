import { describe, expect, it, vi } from 'vitest'
import {
  CLEAN_UP_INSTRUCTIONS,
  CLEAN_UP_PROMPT_VERSION,
  cleanUp,
  outputTokenLimit,
  type TextModelProvider,
} from './llm'

function fakeProvider(answer: string): TextModelProvider {
  return {
    id: 'fake',
    name: 'Fake',
    endpointHost: 'llm.example',
    models: [{ id: 'm1', label: 'M1' }],
    describeUpload: () => 'sends text',
    cleanUp: vi.fn(async () => answer),
  }
}

const request = {
  transcript: 'um the claim is uh weak',
  kind: 'comment' as const,
}
const now = () => new Date('2026-10-29T12:00:00.000Z')

describe('cleanUp', () => {
  it('wraps a checked answer as a proposal with a UTC timestamp', async () => {
    const provider = fakeProvider('The claim is weak.')
    const proposal = await cleanUp(
      provider,
      request,
      { apiKey: 'k', model: 'm1' },
      now,
    )
    expect(proposal).toEqual({
      text: 'The claim is weak.',
      cleanUp: {
        provider: 'fake',
        model: 'm1',
        createdAt: '2026-10-29T12:00:00.000Z',
        promptVersion: CLEAN_UP_PROMPT_VERSION,
      },
    })
  })

  it('rejects an empty, unchanged or oversized answer instead of proposing it', async () => {
    for (const [answer, error] of [
      ['', /empty answer/],
      ['um the claim is uh weak', /unchanged/],
      ['The claim is weak. '.repeat(10), /rejected/],
    ] as const) {
      await expect(
        cleanUp(fakeProvider(answer), request, { apiKey: 'k', model: 'm1' }),
      ).rejects.toThrow(error)
    }
  })

  it('refuses an unknown model or an empty transcript before sending', async () => {
    const provider = fakeProvider('x')
    await expect(
      cleanUp(provider, request, { apiKey: 'k', model: 'other' }),
    ).rejects.toThrow(/Fake has no model "other"/)
    await expect(
      cleanUp(
        provider,
        { ...request, transcript: ' ' },
        {
          apiKey: 'k',
          model: 'm1',
        },
      ),
    ).rejects.toThrow(/no raw transcript/)
    expect(provider.cleanUp).not.toHaveBeenCalled()
  })
})

describe('the clean-up prompt', () => {
  it('forbids changing the critique and asks for the text only', () => {
    expect(CLEAN_UP_PROMPT_VERSION).toBe(1)
    expect(CLEAN_UP_INSTRUCTIONS).toContain(
      'Never add, soften, strengthen or remove a critique',
    )
    expect(CLEAN_UP_INSTRUCTIONS).toContain(
      'Keep the meaning, the language, the register and the length.',
    )
    expect(CLEAN_UP_INSTRUCTIONS).toContain('Return only the edited note text')
  })

  it('leaves room for the answer', () => {
    expect(outputTokenLimit(request)).toBe(2048)
    expect(
      outputTokenLimit({ ...request, transcript: 'x'.repeat(10_000) }),
    ).toBe(5000)
  })
})
