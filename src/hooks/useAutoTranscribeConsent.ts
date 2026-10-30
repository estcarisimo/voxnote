import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  parseConsents,
  retainMatching,
  revokeConsent,
  type AutoTranscribeConsent,
  type AutoTranscribeConsents,
} from '../core/autoTranscribe'
import type { Providers } from './useProviders'

const CONSENTS_KEY = 'voxnote.stt.autoTranscribe'

export interface AutoTranscribeStore {
  /** Every document with a standing consent, keyed by document id. */
  consents: AutoTranscribeConsents
  grant: (consent: AutoTranscribeConsent) => void
  /** Revokes one document's consent, or every one with null. */
  revoke: (documentId: string | null) => void
  error: string | null
}

interface Snapshot {
  consents: AutoTranscribeConsents
  error: string | null
}

/**
 * Standing consents to transcribe on Stop, kept in localStorage beside the
 * speech-to-text settings. A provider, model or language change revokes
 * every consent that named the old one, and so does removing the key of the
 * provider in use: the user is asked again rather than surprised. Revoking
 * is written to storage at once, so switching back does not restore it.
 */
export function useAutoTranscribeConsent(
  providers: Pick<Providers, 'ready' | 'settings' | 'hasKey'>,
): AutoTranscribeStore {
  const [store] = useState(createConsentStore)
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const { ready, settings, hasKey } = providers

  useEffect(() => {
    store.update((current) =>
      ready && !hasKey(settings.provider)
        ? revokeConsent(current, null)
        : retainMatching(current, settings),
    )
  }, [store, ready, settings, hasKey])

  return useMemo(
    () => ({
      consents: snapshot.consents,
      error: snapshot.error,
      grant: (consent: AutoTranscribeConsent) =>
        store.update((current) => ({
          ...current,
          [consent.documentId]: consent,
        })),
      revoke: (documentId: string | null) =>
        store.update((current) => revokeConsent(current, documentId)),
    }),
    [store, snapshot],
  )
}

/** One in-memory copy per hook, written through to localStorage. */
function createConsentStore() {
  let snapshot: Snapshot = { consents: loadConsents(), error: null }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    update(
      change: (current: AutoTranscribeConsents) => AutoTranscribeConsents,
    ) {
      const consents = change(snapshot.consents)
      if (consents === snapshot.consents) return
      let error: string | null = null
      try {
        if (Object.keys(consents).length === 0) {
          localStorage.removeItem(CONSENTS_KEY)
        } else {
          localStorage.setItem(CONSENTS_KEY, JSON.stringify(consents))
        }
      } catch (err: unknown) {
        error = `Auto-transcribe settings could not be saved: ${err instanceof Error ? err.message : String(err)}`
      }
      snapshot = { consents, error }
      for (const listener of listeners) listener()
    },
  }
}

function loadConsents(): AutoTranscribeConsents {
  try {
    const raw = localStorage.getItem(CONSENTS_KEY)
    return raw ? parseConsents(JSON.parse(raw)) : {}
  } catch {
    // Unreadable storage or corrupt JSON: no consent, so the dialog asks
    // again. Failing closed is the safe direction here.
    return {}
  }
}
