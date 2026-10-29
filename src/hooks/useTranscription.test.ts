// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, DEFAULT_TEXT_SETTINGS } from '../providers/registry'
import type { SpeechToTextProvider } from '../providers/stt'
import type { Providers } from './useProviders'
import { useTranscription } from './useTranscription'

function providersWith(overrides: Partial<Providers> = {}): Providers {
  return {
    ready: true,
    error: null,
    settings: DEFAULT_SETTINGS,
    saveSettings: vi.fn(),
    textSettings: DEFAULT_TEXT_SETTINGS,
    saveTextSettings: vi.fn(),
    hasKey: () => true,
    setKey: vi.fn(async () => {}),
    removeKey: vi.fn(async () => {}),
    readKey: vi.fn(async () => 'sk-test'),
    ...overrides,
  }
}

const input = {
  audio: new Blob(['opus'], { type: 'audio/webm' }),
  mimeType: 'audio/webm',
  durationMs: 1000,
  quote: null,
}

function fakeProvider(transcribeImpl: SpeechToTextProvider['transcribe']) {
  const provider: SpeechToTextProvider = {
    id: 'fake',
    name: 'Fake',
    endpointHost: 'stt.example',
    describeUpload: () => 'sends audio',
    transcribe: transcribeImpl,
  }
  return () => provider
}

describe('useTranscription', () => {
  it('rejects without a key or when not ready, opening no dialog', async () => {
    const noKey = renderHook(() =>
      useTranscription(providersWith({ hasKey: () => false })),
    )
    await expect(noKey.result.current.request(input)).rejects.toThrow(
      /Add your OpenAI API key under Providers first/,
    )
    expect(noKey.result.current.pending).toBeNull()

    const notReady = renderHook(() =>
      useTranscription(providersWith({ ready: false })),
    )
    await expect(notReady.result.current.request(input)).rejects.toThrow(
      /not ready/,
    )
  })

  it('sends only on confirm, with the key and an abort signal, then resolves the caller', async () => {
    const transcribeImpl = vi.fn(async () => ({ text: 'hola', model: 'm' }))
    const { result } = renderHook(() =>
      useTranscription(providersWith(), fakeProvider(transcribeImpl)),
    )
    let promise!: ReturnType<typeof result.current.request>
    act(() => {
      promise = result.current.request(input)
    })
    expect(result.current.pending?.input).toBe(input)
    expect(transcribeImpl).not.toHaveBeenCalled()

    const transcript = await result.current.confirm({
      audio: input.audio,
      mimeType: input.mimeType,
    })
    expect(transcribeImpl).toHaveBeenCalledTimes(1)
    const [, options] = transcribeImpl.mock.calls[0] as unknown as [
      unknown,
      { apiKey: string; signal?: AbortSignal },
    ]
    expect(options.apiKey).toBe('sk-test')
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(transcript.raw).toBe('hola')
    expect(transcript.provider).toBe('fake/m')

    act(() => result.current.finish(transcript))
    await expect(promise).resolves.toEqual(transcript)
    expect(result.current.pending).toBeNull()
  })

  it('refuses a second request while one is waiting', async () => {
    const { result } = renderHook(() =>
      useTranscription(providersWith(), fakeProvider(vi.fn())),
    )
    let first!: ReturnType<typeof result.current.request>
    act(() => {
      first = result.current.request(input)
    })
    await expect(result.current.request(input)).rejects.toThrow(
      /Another transcription is waiting/,
    )
    act(() => result.current.finish(null))
    await expect(first).resolves.toBeNull()
  })

  it('cancel resolves null and aborts an upload in flight', async () => {
    let seenSignal: AbortSignal | undefined
    const transcribeImpl = vi.fn(
      (_r: unknown, options: { signal?: AbortSignal }) =>
        new Promise<{ text: string; model: string }>((_, reject) => {
          seenSignal = options.signal
          options.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          )
        }),
    )
    const { result } = renderHook(() =>
      useTranscription(
        providersWith(),
        fakeProvider(transcribeImpl as SpeechToTextProvider['transcribe']),
      ),
    )
    let promise!: ReturnType<typeof result.current.request>
    act(() => {
      promise = result.current.request(input)
    })
    const upload = result.current.confirm({
      audio: input.audio,
      mimeType: input.mimeType,
    })
    await vi.waitFor(() => expect(seenSignal).toBeDefined())
    act(() => result.current.finish(null))
    expect(seenSignal?.aborted).toBe(true)
    await expect(upload).rejects.toThrow(/aborted/)
    await expect(promise).resolves.toBeNull()
  })

  it('settles the caller with null on unmount', async () => {
    const { result, unmount } = renderHook(() =>
      useTranscription(providersWith(), fakeProvider(vi.fn())),
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
      useTranscription(
        providersWith({ readKey: vi.fn(async () => null) }),
        fakeProvider(vi.fn()),
      ),
    )
    act(() => {
      void result.current.request(input)
    })
    await expect(
      result.current.confirm({ audio: input.audio, mimeType: 'audio/webm' }),
    ).rejects.toThrow(/key is missing/)
  })

  it('ignores a result for a request that was already cancelled, and refuses confirm after it', async () => {
    const { result } = renderHook(() =>
      useTranscription(providersWith(), fakeProvider(vi.fn())),
    )
    let first!: ReturnType<typeof result.current.request>
    act(() => {
      first = result.current.request(input)
    })
    const stale = result.current.pending!
    act(() => result.current.finish(null))
    await expect(first).resolves.toBeNull()
    await expect(
      result.current.confirm({ audio: input.audio, mimeType: 'audio/webm' }),
    ).rejects.toThrow(/No transcription is pending/)

    let second!: ReturnType<typeof result.current.request>
    act(() => {
      second = result.current.request(input)
    })
    expect(result.current.pending?.id).not.toBe(stale.id)
    const transcript = {
      raw: 'late',
      provider: 'fake/m',
      transcribedAt: '2026-10-29T10:00:00.000Z',
    }
    // A late result for the stale request must not settle the new one.
    act(() => result.current.finish(transcript, stale))
    expect(result.current.pending).not.toBeNull()
    act(() => result.current.finish(null, result.current.pending!))
    await expect(second).resolves.toBeNull()
  })
})
