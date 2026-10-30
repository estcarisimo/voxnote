// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CleanUpProposal } from '../core/cleanUp'
import type { TextModelProvider } from '../providers/llm'
import { DEFAULT_SETTINGS, type ProviderId } from '../providers/registry'
import { useCleanUp } from './useCleanUp'
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
    removeKey: vi.fn(async () => {}),
    readKey: vi.fn(async (id: ProviderId) => `key-for-${id}`),
    ...overrides,
  }
}

const input = {
  transcript: 'um the claim is uh weak',
  kind: 'comment' as const,
  quote: null,
  currentBody: 'um the claim is uh weak',
}
const request = { transcript: input.transcript, kind: input.kind }

function fakeProvider(cleanUpImpl: TextModelProvider['cleanUp']) {
  const provider: TextModelProvider = {
    id: 'anthropic',
    name: 'Fake',
    endpointHost: 'llm.example',
    models: [{ id: 'claude-haiku-5-5', label: 'Haiku' }],
    describeUpload: () => 'sends text',
    cleanUp: cleanUpImpl,
  }
  return vi.fn(() => provider)
}

describe('useCleanUp', () => {
  it('rejects without a key, when not ready, or without a transcript, opening no dialog', async () => {
    const noKey = renderHook(() =>
      useCleanUp(providersWith({ hasKey: () => false })),
    )
    await expect(noKey.result.current.request(input)).rejects.toThrow(
      /Add your Anthropic \(Claude\) API key under Providers first/,
    )
    expect(noKey.result.current.pending).toBeNull()

    const notReady = renderHook(() =>
      useCleanUp(providersWith({ ready: false })),
    )
    await expect(notReady.result.current.request(input)).rejects.toThrow(
      /not ready/,
    )

    const empty = renderHook(() => useCleanUp(providersWith()))
    await expect(
      empty.result.current.request({ ...input, transcript: ' ' }),
    ).rejects.toThrow(/no raw transcript/)
  })

  it('sends only on confirm, with the provider key, model and an abort signal', async () => {
    const cleanUpImpl = vi.fn(async () => 'The claim is weak.')
    const create = fakeProvider(cleanUpImpl)
    const providers = providersWith()
    const { result } = renderHook(() => useCleanUp(providers, create))
    let promise!: ReturnType<typeof result.current.request>
    act(() => {
      promise = result.current.request(input)
    })
    expect(create).toHaveBeenCalledWith('anthropic')
    expect(result.current.pending?.input).toBe(input)
    expect(result.current.pending?.model).toBe('claude-haiku-5-5')
    expect(cleanUpImpl).not.toHaveBeenCalled()

    const proposal = await result.current.confirm(request)
    expect(providers.readKey).toHaveBeenCalledWith('anthropic')
    const [, options] = cleanUpImpl.mock.calls[0] as unknown as [
      unknown,
      { apiKey: string; model: string; signal?: AbortSignal },
    ]
    expect(options.apiKey).toBe('key-for-anthropic')
    expect(options.model).toBe('claude-haiku-5-5')
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(proposal.text).toBe('The claim is weak.')
    expect(proposal.cleanUp.provider).toBe('anthropic')

    act(() => result.current.finish(proposal))
    await expect(promise).resolves.toEqual(proposal)
    expect(result.current.pending).toBeNull()
  })

  it('rejects a bad answer at confirm and keeps the request pending', async () => {
    const { result } = renderHook(() =>
      useCleanUp(
        providersWith(),
        fakeProvider(vi.fn(async () => input.transcript)),
      ),
    )
    act(() => {
      void result.current.request(input)
    })
    await expect(result.current.confirm(request)).rejects.toThrow(/unchanged/)
    expect(result.current.pending).not.toBeNull()
  })

  it('refuses a second request while one is waiting', async () => {
    const { result } = renderHook(() =>
      useCleanUp(providersWith(), fakeProvider(vi.fn())),
    )
    let first!: ReturnType<typeof result.current.request>
    act(() => {
      first = result.current.request(input)
    })
    await expect(result.current.request(input)).rejects.toThrow(
      /Another clean-up is waiting/,
    )
    act(() => result.current.finish(null))
    await expect(first).resolves.toBeNull()
  })

  it('cancel resolves null and aborts a request in flight', async () => {
    let seenSignal: AbortSignal | undefined
    const cleanUpImpl = vi.fn(
      (_r: unknown, options: { signal?: AbortSignal }) =>
        new Promise<string>((_, reject) => {
          seenSignal = options.signal
          options.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          )
        }),
    )
    const { result } = renderHook(() =>
      useCleanUp(
        providersWith(),
        fakeProvider(cleanUpImpl as TextModelProvider['cleanUp']),
      ),
    )
    let promise!: ReturnType<typeof result.current.request>
    act(() => {
      promise = result.current.request(input)
    })
    const sending = result.current.confirm(request)
    await vi.waitFor(() => expect(seenSignal).toBeDefined())
    act(() => result.current.finish(null))
    expect(seenSignal?.aborted).toBe(true)
    await expect(sending).rejects.toThrow(/aborted/)
    await expect(promise).resolves.toBeNull()
  })

  it('settles the caller with null on unmount', async () => {
    const { result, unmount } = renderHook(() =>
      useCleanUp(providersWith(), fakeProvider(vi.fn())),
    )
    let promise!: ReturnType<typeof result.current.request>
    act(() => {
      promise = result.current.request(input)
    })
    unmount()
    await expect(promise).resolves.toBeNull()
  })

  it('refuses to send when the stored key vanished', async () => {
    const { result } = renderHook(() =>
      useCleanUp(
        providersWith({ readKey: vi.fn(async () => null) }),
        fakeProvider(vi.fn()),
      ),
    )
    act(() => {
      void result.current.request(input)
    })
    await expect(result.current.confirm(request)).rejects.toThrow(
      /key is missing/,
    )
  })

  it('ignores a result for a request already cancelled, and refuses confirm after it', async () => {
    const { result } = renderHook(() =>
      useCleanUp(providersWith(), fakeProvider(vi.fn())),
    )
    let first!: ReturnType<typeof result.current.request>
    act(() => {
      first = result.current.request(input)
    })
    const stale = result.current.pending!
    act(() => result.current.finish(null))
    await expect(first).resolves.toBeNull()
    await expect(result.current.confirm(request)).rejects.toThrow(
      /No clean-up is pending/,
    )

    let second!: ReturnType<typeof result.current.request>
    act(() => {
      second = result.current.request(input)
    })
    expect(result.current.pending?.id).not.toBe(stale.id)
    const late: CleanUpProposal = {
      text: 'Late.',
      cleanUp: {
        provider: 'anthropic',
        model: 'claude-haiku-5-5',
        createdAt: '2026-10-29T10:00:00.000Z',
        promptVersion: 1,
      },
    }
    act(() => result.current.finish(late, stale))
    expect(result.current.pending).not.toBeNull()
    act(() => result.current.finish(null, result.current.pending!))
    await expect(second).resolves.toBeNull()
  })
})
