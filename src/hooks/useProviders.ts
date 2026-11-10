import { useCallback, useEffect, useMemo, useState } from 'react'
import { openSecretStore, type SecretStore } from '../core/secrets'
import type { LocalServer } from '../providers/local'
import {
  DEFAULT_SETTINGS,
  isLocalProviderId,
  DEFAULT_TEXT_SETTINGS,
  normalizeSettings,
  normalizeTextSettings,
  SECRET_NAMES,
  STT_PROVIDER_IDS,
  TEXT_PROVIDER_IDS,
  type LocalProviderId,
  type ProviderId,
  type SttSettings,
  type TextSettings,
} from '../providers/registry'

const SETTINGS_KEY = 'voxnote.stt.settings'
const TEXT_SETTINGS_KEY = 'voxnote.text.settings'

export interface Providers {
  /** False until the secret store opened and the key names were listed. */
  ready: boolean
  error: string | null
  settings: SttSettings
  saveSettings: (settings: SttSettings) => void
  /** Which text provider and model clean up transcripts. */
  textSettings: TextSettings
  saveTextSettings: (settings: TextSettings) => void
  /**
   * Which providers have a key stored, or, for a local provider, a server
   * configured; key values are never exposed here.
   */
  hasKey: (id: ProviderId) => boolean
  setKey: (id: ProviderId, value: string) => Promise<void>
  /**
   * Sets up a local server and picks it for its role: its address and model
   * go to the settings, a non-empty key to the secret store (an empty one
   * removes a stored key).
   */
  configureLocal: (
    id: LocalProviderId,
    server: LocalServer,
    apiKey: string,
  ) => Promise<void>
  /**
   * Removes a key. For a local provider, the server settings too, and its
   * role moves to the first other provider with a key (or the default).
   */
  removeKey: (id: ProviderId) => Promise<void>
  /**
   * Reads the decrypted key for one request. Null when none is stored; a
   * configured local server without a key reads as "" (no key to send).
   */
  readKey: (id: ProviderId) => Promise<string | null>
}

/**
 * The user's own provider keys and the non-secret settings that pick a
 * provider and model. Keys go through the encrypted secret store; settings
 * go to localStorage. Nothing here contacts a provider.
 */
export function useProviders(): Providers {
  const [store, setStore] = useState<SecretStore | null>(null)
  const [stored, setStored] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<SttSettings>(loadSettings)
  const [textSettings, setTextSettings] =
    useState<TextSettings>(loadTextSettings)

  useEffect(() => {
    let cancelled = false
    let opened: SecretStore | null = null
    openSecretStore()
      .then(async (s) => {
        if (cancelled) {
          s.close()
          return
        }
        opened = s
        const names = await s.list()
        if (cancelled) return
        setStore(s)
        setStored(names)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(
          `AI keys are unavailable: ${err instanceof Error ? err.message : String(err)}`,
        )
      })
    return () => {
      cancelled = true
      opened?.close()
    }
  }, [])

  const saveSettings = useCallback((next: SttSettings) => {
    const normalized = normalizeSettings(next)
    setSettings(normalized)
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized))
    } catch (err: unknown) {
      setError(
        `Settings could not be saved: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }, [])

  const saveTextSettings = useCallback((next: TextSettings) => {
    const normalized = normalizeTextSettings(next)
    setTextSettings(normalized)
    try {
      localStorage.setItem(TEXT_SETTINGS_KEY, JSON.stringify(normalized))
    } catch (err: unknown) {
      setError(
        `Settings could not be saved: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }, [])

  const hasKey = useCallback(
    (id: ProviderId) => {
      if (id === 'local-stt') return settings.local !== undefined
      if (id === 'local-text') return textSettings.local !== undefined
      return stored.includes(SECRET_NAMES[id])
    },
    [stored, settings.local, textSettings.local],
  )

  const configureLocal = useCallback(
    async (id: LocalProviderId, server: LocalServer, apiKey: string) => {
      if (!store) throw new Error('The secret store is not ready')
      const name = SECRET_NAMES[id]
      if (apiKey.trim() !== '') {
        await store.set(name, apiKey.trim())
      } else if ((await store.list()).includes(name)) {
        await store.delete(name)
      }
      setStored(await store.list())
      if (id === 'local-stt') {
        saveSettings({ ...settings, provider: id, model: '', local: server })
      } else {
        saveTextSettings({ provider: id, model: '', local: server })
      }
    },
    [store, settings, saveSettings, saveTextSettings],
  )

  const setKey = useCallback(
    async (id: ProviderId, value: string) => {
      if (!store) throw new Error('The secret store is not ready')
      await store.set(SECRET_NAMES[id], value.trim())
      setStored(await store.list())
    },
    [store],
  )

  const removeKey = useCallback(
    async (id: ProviderId) => {
      if (!store) throw new Error('The secret store is not ready')
      const name = SECRET_NAMES[id]
      if (!isLocalProviderId(id) || (await store.list()).includes(name)) {
        await store.delete(name)
      }
      const names = await store.list()
      setStored(names)
      const keyed = (p: ProviderId) => names.includes(SECRET_NAMES[p])
      if (id === 'local-stt') {
        const provider =
          settings.provider === id
            ? (STT_PROVIDER_IDS.find((p) => p !== id && keyed(p)) ??
              DEFAULT_SETTINGS.provider)
            : settings.provider
        saveSettings({
          provider,
          model: provider === settings.provider ? settings.model : '',
          language: settings.language,
        })
      }
      if (id === 'local-text') {
        const provider =
          textSettings.provider === id
            ? (TEXT_PROVIDER_IDS.find((p) => p !== id && keyed(p)) ??
              DEFAULT_TEXT_SETTINGS.provider)
            : textSettings.provider
        saveTextSettings({
          provider,
          model: provider === textSettings.provider ? textSettings.model : '',
        })
      }
    },
    [store, settings, textSettings, saveSettings, saveTextSettings],
  )

  const readKey = useCallback(
    async (id: ProviderId) => {
      if (!store) throw new Error('The secret store is not ready')
      const key = await store.get(SECRET_NAMES[id])
      if (key === null && isLocalProviderId(id) && hasKey(id)) return ''
      return key
    },
    [store, hasKey],
  )

  const ready = store !== null
  return useMemo(
    () => ({
      ready,
      error,
      settings,
      saveSettings,
      textSettings,
      saveTextSettings,
      hasKey,
      setKey,
      configureLocal,
      removeKey,
      readKey,
    }),
    [
      ready,
      error,
      settings,
      saveSettings,
      textSettings,
      saveTextSettings,
      hasKey,
      setKey,
      configureLocal,
      removeKey,
      readKey,
    ],
  )
}

function loadSettings(): SttSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? normalizeSettings(JSON.parse(raw)) : DEFAULT_SETTINGS
  } catch {
    // Unreadable storage or corrupt JSON: defaults, and the user can save
    // again. Not worth blocking the app for.
    return DEFAULT_SETTINGS
  }
}

function loadTextSettings(): TextSettings {
  try {
    const raw = localStorage.getItem(TEXT_SETTINGS_KEY)
    return raw ? normalizeTextSettings(JSON.parse(raw)) : DEFAULT_TEXT_SETTINGS
  } catch {
    // Same as loadSettings: defaults, and the user can save again.
    return DEFAULT_TEXT_SETTINGS
  }
}
