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
