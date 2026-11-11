// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { askPrompt } from '../core/ask'
import type { TextModelProvider } from '../providers/llm'
import { DEFAULT_SETTINGS, type ProviderId } from '../providers/registry'
import { useAsk, type AskInput } from './useAsk'
import type { Providers } from './useProviders'

function providersWith(overrides: Partial<Providers> = {}): Providers {
  return {
    ready: true,
    error: null,
    settings: DEFAULT_SETTINGS,
    saveSettings: vi.fn(),
    textSettings: { provider: 'anthropic', model: 'claude-haiku-5-5' },
    saveTextSettings: vi.fn(),
    hasKey: () => true,
    setKey: vi.fn(async () => {}),
    configureLocal: vi.fn(async () => {}),
    removeKey: vi.fn(async () => {}),
    readKey: vi.fn(async (id: ProviderId) => `key-for-${id}`),
    ...overrides,
  }
}

const input: AskInput = {
  question: 'What is decoherence?',
  quote: 'the qubit decoheres',
  place: 'page 2',
  surrounding: null,
  earlier: [],
}
const request = { question: input.question, quote: input.quote }

function fakeProvider(generate: TextModelProvider['generate']) {
  const provider: TextModelProvider = {
    id: 'anthropic',
    name: 'Fake',
    endpointHost: 'llm.example',
    models: [{ id: 'claude-haiku-5-5', label: 'Haiku' }],
    describeDestination: () => 'to llm.example',
    generate,
  }
  return vi.fn(() => provider)
}

describe('useAsk', () => {
  it('rejects without a key, when not ready, or without a question, opening no dialog', async () => {
    const noKey = renderHook(() =>
      useAsk(providersWith({ hasKey: () => false })),
    )
    await expect(noKey.result.current.request(input)).rejects.toThrow(
      /Add your Anthropic \(Claude\) key in AI keys first/,
    )
    expect(noKey.result.current.pending).toBeNull()

    const notReady = renderHook(() => useAsk(providersWith({ ready: false })))
    await expect(notReady.result.current.request(input)).rejects.toThrow(
      /not ready/,
    )

    const empty = renderHook(() => useAsk(providersWith()))
    await expect(
      empty.result.current.request({ ...input, question: ' ' }),
    ).rejects.toThrow(/Write the question/)
  })

  it('sends only on confirm, with the key, the model, the ask prompt and an abort signal', async () => {
    const generate = vi.fn(async () => 'The loss of superposition.')
    const create = fakeProvider(generate)
    const providers = providersWith()
    const { result } = renderHook(() => useAsk(providers, create))
    let promise!: ReturnType<typeof result.current.request>
    act(() => {
      promise = result.current.request(input)
    })
    expect(result.current.pending?.input).toBe(input)
    expect(generate).not.toHaveBeenCalled()

    const answer = await result.current.confirm(request)
    const [prompt, options] = generate.mock.calls[0] as unknown as [
      unknown,
      { apiKey: string; model: string; signal?: AbortSignal },
    ]
    expect(prompt).toEqual(askPrompt(request))
    expect(options.apiKey).toBe('key-for-anthropic')
    expect(options.model).toBe('claude-haiku-5-5')
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(answer.text).toBe('The loss of superposition.')
    expect(answer.provider).toBe('anthropic')

    act(() => result.current.finish(answer))
    await expect(promise).resolves.toEqual(answer)
    expect(result.current.pending).toBeNull()
  })

  it('refuses a second request while one is waiting; cancel resolves null and aborts', async () => {
    let seen: AbortSignal | undefined
    const generate = vi.fn(
      (_p: unknown, options: { signal?: AbortSignal }) =>
        new Promise<string>((_, reject) => {
          seen = options.signal
          options.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          )
        }),
    )
    const { result } = renderHook(() =>
      useAsk(
        providersWith(),
        fakeProvider(generate as TextModelProvider['generate']),
      ),
    )
    let first!: ReturnType<typeof result.current.request>
    act(() => {
      first = result.current.request(input)
    })
    await expect(result.current.request(input)).rejects.toThrow(
      /Another request is waiting/,
    )
    const sending = result.current.confirm(request)
    await vi.waitFor(() => expect(seen).toBeDefined())
    act(() => result.current.finish(null))
    await expect(first).resolves.toBeNull()
    await expect(sending).rejects.toThrow(/aborted/)
    expect(seen?.aborted).toBe(true)
  })

  it('never sends a missing cloud key', async () => {
    const generate = vi.fn(async () => 'x')
    const { result } = renderHook(() =>
      useAsk(
        providersWith({ readKey: vi.fn(async () => '') }),
        fakeProvider(generate),
      ),
    )
    act(() => {
      void result.current.request(input)
    })
    await expect(result.current.confirm(request)).rejects.toThrow(
      /key is missing/,
    )
    expect(generate).not.toHaveBeenCalled()
  })
})
