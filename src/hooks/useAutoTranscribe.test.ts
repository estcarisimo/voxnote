// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, DEFAULT_TEXT_SETTINGS } from '../providers/registry'
import type { SpeechToTextProvider } from '../providers/stt'
import { useAutoTranscribeConsent } from './useAutoTranscribeConsent'
import type { Providers } from './useProviders'
import { useTranscription } from './useTranscription'

const STORAGE_KEY = 'voxnote.stt.autoTranscribe'

function providersWith(overrides: Partial<Providers> = {}): Providers {
  return {
    ready: true,
    error: null,
    settings: { ...DEFAULT_SETTINGS, language: 'es' },
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
  quote: 'the quoted passage',
}

const transcriptOf = (text: string) => ({ text, model: 'gpt-transcribe' })

function fakeProvider(transcribeImpl: SpeechToTextProvider['transcribe']) {
  const provider: SpeechToTextProvider = {
    id: 'openai',
    name: 'OpenAI',
    endpointHost: 'api.openai.com',
    describeUpload: () => 'Sends the recording to OpenAI at api.openai.com.',
    transcribe: transcribeImpl,
  }
  return () => provider
}

interface Props {
  providers: Providers
  documentId: string | null
  create: () => SpeechToTextProvider
}

function render(initial: Props) {
  return renderHook(
    ({ providers, documentId, create }: Props) => {
      const store = useAutoTranscribeConsent(providers)
      const flow = useTranscription(providers, { documentId, store }, create)
      return { store, flow }
    },
    { initialProps: initial },
  )
}

/** Sends one recording through the dialog with the checkbox ticked. */
async function grantThroughDialog(result: ReturnType<typeof render>['result']) {
  let promise!: Promise<unknown>
  act(() => {
    promise = result.current.flow.request(input)
  })
  expect(result.current.flow.pending?.offerStanding).toBe(true)
  expect(result.current.flow.pending?.automatic).toBe(false)
  let transcript!: Awaited<ReturnType<typeof result.current.flow.confirm>>
  await act(async () => {
    transcript = await result.current.flow.confirm(
      { audio: input.audio, mimeType: input.mimeType, language: 'es' },
      { standing: true },
    )
  })
  act(() => result.current.flow.finish(transcript))
  await promise
}

describe('transcribe on Stop under a standing consent', () => {
  beforeEach(() => localStorage.clear())

  it('is granted only through the dialog, with what it names and a UTC time', async () => {
    const transcribeImpl = vi.fn(async () => transcriptOf('uno'))
    const { result } = render({
      providers: providersWith(),
      documentId: 'doc-a',
      create: fakeProvider(transcribeImpl),
    })
    expect(result.current.flow.auto?.active).toBe(false)
    await grantThroughDialog(result)

    const consent = result.current.store.consents['doc-a']
    expect(consent).toMatchObject({
      documentId: 'doc-a',
      provider: 'openai',
      model: DEFAULT_SETTINGS.model,
      host: 'api.openai.com',
      language: 'es',
      includeQuote: false,
    })
    expect(consent.disclosure).toBe(
      'Sends the recording to OpenAI at api.openai.com. From now on, each ' +
        'recording in this document is sent to OpenAI at api.openai.com as ' +
        'soon as you tap Stop. You can turn this off in the composer or ' +
        'under the key settings.',
    )
    expect(consent.grantedAt).toMatch(/Z$/)
    expect(result.current.flow.auto?.active).toBe(true)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toHaveProperty(
      'doc-a',
    )
  })

  it('sends an automatic request at once, with the language hint and no dialog', async () => {
    const transcribeImpl = vi.fn(async () => transcriptOf('dos'))
    const { result } = render({
      providers: providersWith(),
      documentId: 'doc-a',
      create: fakeProvider(transcribeImpl),
    })
    await grantThroughDialog(result)
    transcribeImpl.mockClear()

    let promise!: ReturnType<typeof result.current.flow.request>
    act(() => {
      promise = result.current.flow.request(input, { automatic: true })
    })
    expect(result.current.flow.pending?.automatic).toBe(true)
    await expect(promise).resolves.toMatchObject({ raw: 'dos' })
    expect(transcribeImpl).toHaveBeenCalledTimes(1)
    const [request, options] = transcribeImpl.mock.calls[0] as unknown as [
      Record<string, unknown>,
      { apiKey: string; signal: AbortSignal },
    ]
    // The quote was not ticked when granting, so it is not sent now either.
    expect(request).toEqual({
      audio: input.audio,
      mimeType: 'audio/webm',
      language: 'es',
    })
    expect(options.apiKey).toBe('sk-test')
    await waitFor(() => expect(result.current.flow.pending).toBeNull())
  })

  it('refuses an automatic request without a consent, sending nothing', async () => {
    const transcribeImpl = vi.fn(async () => transcriptOf('x'))
    const { result } = render({
      providers: providersWith(),
      documentId: 'doc-a',
      create: fakeProvider(transcribeImpl),
    })
    await expect(
      result.current.flow.request(input, { automatic: true }),
    ).rejects.toThrow(/Auto-transcribe is off/)
    expect(transcribeImpl).not.toHaveBeenCalled()
    expect(result.current.flow.pending).toBeNull()
  })

  it('is revoked in one tap and then refuses automatic requests', async () => {
    const transcribeImpl = vi.fn(async () => transcriptOf('x'))
    const { result } = render({
      providers: providersWith(),
      documentId: 'doc-a',
      create: fakeProvider(transcribeImpl),
    })
    await grantThroughDialog(result)
    transcribeImpl.mockClear()
    act(() => result.current.flow.auto!.revoke())
    expect(result.current.flow.auto?.active).toBe(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    await expect(
      result.current.flow.request(input, { automatic: true }),
    ).rejects.toThrow(/Auto-transcribe is off/)
    expect(transcribeImpl).not.toHaveBeenCalled()
  })

  it('is revoked by a model change, and switching back does not restore it', async () => {
    const providers = providersWith()
    const create = fakeProvider(vi.fn(async () => transcriptOf('x')))
    const { result, rerender } = render({
      providers,
      documentId: 'doc-a',
      create,
    })
    await grantThroughDialog(result)
    rerender({
      providers: providersWith({
        settings: { ...providers.settings, model: 'whisper-1' },
      }),
      documentId: 'doc-a',
      create,
    })
    await waitFor(() => expect(result.current.store.consents).toEqual({}))
    rerender({ providers, documentId: 'doc-a', create })
    expect(result.current.flow.auto?.active).toBe(false)
  })

  it('is revoked when the key of the provider in use is removed', async () => {
    const providers = providersWith()
    const create = fakeProvider(vi.fn(async () => transcriptOf('x')))
    const { result, rerender } = render({
      providers,
      documentId: 'doc-a',
      create,
    })
    await grantThroughDialog(result)
    rerender({
      providers: providersWith({ hasKey: () => false }),
      documentId: 'doc-a',
      create,
    })
    await waitFor(() => expect(result.current.store.consents).toEqual({}))
  })

  it('belongs to one document: another starts without it, and it persists across reloads', async () => {
    const providers = providersWith()
    const create = fakeProvider(vi.fn(async () => transcriptOf('x')))
    const first = render({ providers, documentId: 'doc-a', create })
    await grantThroughDialog(first.result)
    first.rerender({ providers, documentId: 'doc-b', create })
    expect(first.result.current.flow.auto?.active).toBe(false)
    expect(first.result.current.flow.auto?.consent).toBeNull()
    first.unmount()

    const reloaded = render({ providers, documentId: 'doc-a', create })
    expect(reloaded.result.current.flow.auto?.active).toBe(true)
    const other = render({ providers, documentId: 'doc-b', create })
    expect(other.result.current.flow.auto?.active).toBe(false)
    act(() => {
      void other.result.current.flow.request(input)
    })
    expect(other.result.current.flow.pending?.offerStanding).toBe(true)
  })

  it('cancels an automatic upload through its signal, aborting the request', async () => {
    let seen: AbortSignal | undefined
    const transcribeImpl = vi.fn(
      (_request: unknown, options: { signal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          seen = options.signal
          options.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    )
    const { result } = render({
      providers: providersWith(),
      documentId: 'doc-a',
      create: fakeProvider(
        transcribeImpl as SpeechToTextProvider['transcribe'],
      ),
    })
    // Grant with a provider that answers, then switch to the hanging one.
    localStorage.clear()
    const quick = render({
      providers: providersWith(),
      documentId: 'doc-a',
      create: fakeProvider(vi.fn(async () => transcriptOf('x'))),
    })
    await grantThroughDialog(quick.result)
    act(() =>
      result.current.store.grant(quick.result.current.store.consents['doc-a']),
    )

    const controller = new AbortController()
    let promise!: ReturnType<typeof result.current.flow.request>
    act(() => {
      promise = result.current.flow.request(input, {
        automatic: true,
        signal: controller.signal,
      })
    })
    await waitFor(() => expect(seen).toBeDefined())
    act(() => controller.abort())
    await expect(promise).resolves.toBeNull()
    expect(seen?.aborted).toBe(true)
    expect(result.current.flow.pending).toBeNull()
  })

  it('rejects the caller when an automatic upload fails, freeing the slot', async () => {
    const transcribeImpl = vi
      .fn<SpeechToTextProvider['transcribe']>()
      .mockResolvedValueOnce(transcriptOf('granted'))
      .mockRejectedValueOnce(new Error('OpenAI said 500'))
    const { result } = render({
      providers: providersWith(),
      documentId: 'doc-a',
      create: fakeProvider(transcribeImpl),
    })
    await grantThroughDialog(result)
    await expect(
      result.current.flow.request(input, { automatic: true }),
    ).rejects.toThrow(/OpenAI said 500/)
    await waitFor(() => expect(result.current.flow.pending).toBeNull())
  })

  it('does not offer the checkbox without an open document', () => {
    const { result } = render({
      providers: providersWith(),
      documentId: null,
      create: fakeProvider(vi.fn()),
    })
    expect(result.current.flow.auto).toBeNull()
    act(() => {
      void result.current.flow.request(input)
    })
    expect(result.current.flow.pending?.offerStanding).toBe(false)
  })
})
