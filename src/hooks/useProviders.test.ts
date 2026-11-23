// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SecretStore } from '../core/secrets'

const secrets = new Map<string, string>()
const fakeStore: SecretStore = {
  get: vi.fn(async (name: string) => secrets.get(name) ?? null),
  set: vi.fn(async (name: string, value: string) => {
    secrets.set(name, value)
  }),
  delete: vi.fn(async (name: string) => {
    secrets.delete(name)
  }),
  list: vi.fn(async () => [...secrets.keys()].sort()),
  close: vi.fn(),
}
vi.mock('../core/secrets', () => ({
  openSecretStore: vi.fn(async () => fakeStore),
}))

const { useProviders } = await import('./useProviders')
const {
  ANTHROPIC_CATALOG_KEY,
  anthropicCatalog,
  refreshAnthropicCatalog,
  resetAnthropicCatalog,
} = await import('../providers/anthropicCatalog')

const sttServer = { baseUrl: 'http://localhost:8080/v1', model: 'whisper-1' }
const textServer = {
  baseUrl: 'http://localhost:11434/v1',
  model: 'llama3.2:3b',
}

async function ready() {
  const hook = renderHook(() => useProviders())
  await waitFor(() => expect(hook.result.current.ready).toBe(true))
  return hook
}

describe('useProviders with local servers', () => {
  beforeEach(() => {
    secrets.clear()
    localStorage.clear()
  })

  it('configures a local server without a key: picked for its role, readKey is ""', async () => {
    const { result } = await ready()
    await act(() => result.current.configureLocal('local-text', textServer, ''))
    expect(result.current.hasKey('local-text')).toBe(true)
    expect(result.current.textSettings).toEqual({
      provider: 'local-text',
      model: 'llama3.2:3b',
      local: textServer,
    })
    await expect(result.current.readKey('local-text')).resolves.toBe('')
    await expect(result.current.readKey('openai')).resolves.toBeNull()
  })

  it('stores an optional key, and an empty key removes it', async () => {
    const { result } = await ready()
    await act(() =>
      result.current.configureLocal('local-stt', sttServer, ' k '),
    )
    await expect(result.current.readKey('local-stt')).resolves.toBe('k')
    await act(() => result.current.configureLocal('local-stt', sttServer, ''))
    expect(secrets.has('local-stt.apiKey')).toBe(false)
    expect(result.current.settings.provider).toBe('local-stt')
    expect(result.current.settings.model).toBe('whisper-1')
  })

  it('removing a local server drops its key and hands its role to a keyed provider', async () => {
    const { result } = await ready()
    await act(() => result.current.setKey('groq', 'gsk_test'))
    await act(() => result.current.configureLocal('local-stt', sttServer, 'k'))
    await act(() =>
      result.current.saveSettings({
        ...result.current.settings,
        language: 'es',
      }),
    )
    await act(() => result.current.removeKey('local-stt'))
    expect(result.current.hasKey('local-stt')).toBe(false)
    expect(secrets.has('local-stt.apiKey')).toBe(false)
    expect(result.current.settings).toEqual({
      provider: 'groq',
      model: 'whisper-large-v3-turbo',
      language: 'es',
    })
  })

  it('keeps a local server while another provider is picked, and persists it', async () => {
    const { result, unmount } = await ready()
    await act(() => result.current.configureLocal('local-text', textServer, ''))
    act(() =>
      result.current.saveTextSettings({
        ...result.current.textSettings,
        provider: 'anthropic',
        model: '',
      }),
    )
    expect(result.current.hasKey('local-text')).toBe(true)
    unmount()
    const again = await ready()
    expect(again.result.current.textSettings.local).toEqual(textServer)
  })
})

describe('useProviders and the Claude model list', () => {
  beforeEach(() => {
    secrets.clear()
    localStorage.clear()
    resetAnthropicCatalog()
  })

  function listing(...ids: string[]) {
    return new Response(
      JSON.stringify({ data: ids.map((id) => ({ id })), has_more: false }),
      { status: 200 },
    )
  }

  it('moves the picked Claude model to the newest of its family when the list changes, and saves it', async () => {
    localStorage.setItem(
      'voxnote.text.settings',
      JSON.stringify({ provider: 'anthropic', model: 'claude-fable-5-2' }),
    )
    const { result } = await ready()
    expect(result.current.textSettings.model).toBe('claude-fable-5-2')
    const fetchImpl = vi.fn(async () =>
      listing('claude-fable-5-3', 'claude-opus-5-5'),
    ) as unknown as typeof fetch
    await act(() => refreshAnthropicCatalog('sk-ant-test', fetchImpl))
    expect(result.current.textSettings).toEqual({
      provider: 'anthropic',
      model: 'claude-fable-5-3',
    })
    expect(
      JSON.parse(localStorage.getItem('voxnote.text.settings') ?? ''),
    ).toEqual({ provider: 'anthropic', model: 'claude-fable-5-3' })
  })

  it('never undoes a provider change made while the list was loading', async () => {
    localStorage.setItem(
      'voxnote.text.settings',
      JSON.stringify({ provider: 'anthropic', model: 'claude-opus-5-5' }),
    )
    const { result } = await ready()
    let answer: (response: Response) => void = () => {}
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve
        }),
    ) as unknown as typeof fetch
    let pending: Promise<unknown> = Promise.resolve()
    act(() => {
      pending = refreshAnthropicCatalog('sk-ant-test', fetchImpl)
    })
    act(() =>
      result.current.saveTextSettings({ provider: 'openai', model: '' }),
    )
    await act(async () => {
      answer(listing('claude-opus-5-5'))
      await pending
    })
    expect(result.current.textSettings.provider).toBe('openai')
  })

  it('goes back to the built-in list when the Anthropic key is removed or replaced', async () => {
    const { result } = await ready()
    await act(() => result.current.setKey('anthropic', 'sk-ant-one'))
    await act(() =>
      refreshAnthropicCatalog(
        'sk-ant-one',
        vi.fn(async () =>
          listing('claude-mythos-5-2', 'claude-opus-5-5'),
        ) as unknown as typeof fetch,
      ),
    )
    expect(anthropicCatalog().fetchedAt).not.toBeNull()
    await act(() => result.current.setKey('anthropic', 'sk-ant-two'))
    expect(anthropicCatalog().fetchedAt).toBeNull()
    expect(localStorage.getItem(ANTHROPIC_CATALOG_KEY)).toBeNull()

    await act(() =>
      refreshAnthropicCatalog(
        'sk-ant-two',
        vi.fn(async () =>
          listing('claude-opus-5-5'),
        ) as unknown as typeof fetch,
      ),
    )
    await act(() => result.current.removeKey('anthropic'))
    expect(anthropicCatalog().fetchedAt).toBeNull()
  })
})
