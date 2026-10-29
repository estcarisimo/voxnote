import { useCallback, useEffect, useMemo, useState } from 'react'
import { openSecretStore, type SecretStore } from '../core/secrets'
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  SECRET_NAMES,
  type ProviderId,
  type SttSettings,
} from '../providers/registry'

const SETTINGS_KEY = 'voxnote.stt.settings'

export interface Providers {
  /** False until the secret store opened and the key names were listed. */
  ready: boolean
  error: string | null
  settings: SttSettings
  saveSettings: (settings: SttSettings) => void
  /** Which providers have a key stored; values are never exposed here. */
  hasKey: (id: ProviderId) => boolean
  setKey: (id: ProviderId, value: string) => Promise<void>
  removeKey: (id: ProviderId) => Promise<void>
  /** Reads the decrypted key for one request. Null when none is stored. */
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
          `Provider keys are unavailable: ${err instanceof Error ? err.message : String(err)}`,
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

  const hasKey = useCallback(
    (id: ProviderId) => stored.includes(SECRET_NAMES[id]),
    [stored],
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
      await store.delete(SECRET_NAMES[id])
      setStored(await store.list())
    },
    [store],
  )

  const readKey = useCallback(
    async (id: ProviderId) => {
      if (!store) throw new Error('The secret store is not ready')
      return store.get(SECRET_NAMES[id])
    },
    [store],
  )

  const ready = store !== null
  return useMemo(
    () => ({
      ready,
      error,
      settings,
      saveSettings,
      hasKey,
      setKey,
      removeKey,
      readKey,
    }),
    [ready, error, settings, saveSettings, hasKey, setKey, removeKey, readKey],
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
