import { useCallback, useEffect, useRef, useState } from 'react'
import type { Transcript } from '../core/annotations'
import type {
  TranscribeFn,
  TranscriptionInput,
} from '../components/TranscribeDialog'
import {
  createProvider,
  PROVIDER_LABELS,
  type SttSettings,
} from '../providers/registry'
import {
  transcribe,
  type SpeechToTextProvider,
  type TranscriptionRequest,
} from '../providers/stt'
import type { Providers } from './useProviders'

/** An upload waiting for the user's consent in the dialog. */
export interface PendingUpload {
  input: TranscriptionInput
  provider: SpeechToTextProvider
}

export interface TranscriptionFlow {
  /** The upload the consent dialog should show, if any. */
  pending: PendingUpload | null
  /**
   * Opens the consent step. Resolves with the transcript after Send, with
   * null after Cancel (or when the document changes), and rejects when no
   * key is stored, another request is already waiting, or the upload fails.
   */
  request: TranscribeFn
  /** Runs the upload for the pending request; called by the dialog's Send. */
  confirm: (request: TranscriptionRequest) => Promise<Transcript>
  /** Settles the pending request; null aborts an upload in flight. */
  finish: (transcript: Transcript | null) => void
}

interface Pending extends PendingUpload {
  resolve: (transcript: Transcript | null) => void
  controller: AbortController
}

/**
 * Consent-gated transcription. Nothing here contacts a provider until
 * `confirm` runs, and `confirm` is only reachable from the dialog. One
 * request at a time: a second one is refused rather than silently orphaning
 * the first, which would leave its caller stuck on "Transcribing…".
 */
export function useTranscription(
  providers: Providers,
  createProviderImpl: (
    settings: SttSettings,
  ) => SpeechToTextProvider = createProvider,
): TranscriptionFlow {
  const [pending, setPending] = useState<Pending | null>(null)
  const pendingRef = useRef<Pending | null>(null)

  const finish = useCallback((transcript: Transcript | null) => {
    const current = pendingRef.current
    if (!current) return
    pendingRef.current = null
    setPending(null)
    if (transcript === null) current.controller.abort()
    current.resolve(transcript)
  }, [])

  // Unmount settles whatever is waiting, so no caller hangs.
  useEffect(() => () => finish(null), [finish])

  const request = useCallback<TranscribeFn>(
    (input) =>
      new Promise((resolve, reject) => {
        if (pendingRef.current) {
          reject(
            new Error('Another transcription is waiting for your confirmation'),
          )
          return
        }
        const { settings } = providers
        if (!providers.ready) {
          reject(new Error('Provider keys are not ready yet'))
          return
        }
        if (!providers.hasKey(settings.provider)) {
          reject(
            new Error(
              `Add your ${PROVIDER_LABELS[settings.provider]} API key under Providers first`,
            ),
          )
          return
        }
        let provider: SpeechToTextProvider
        try {
          provider = createProviderImpl(settings)
        } catch (err: unknown) {
          reject(err instanceof Error ? err : new Error(String(err)))
          return
        }
        const next: Pending = {
          input,
          provider,
          resolve,
          controller: new AbortController(),
        }
        pendingRef.current = next
        setPending(next)
      }),
    [providers, createProviderImpl],
  )

  const confirm = useCallback(
    async (transcriptionRequest: TranscriptionRequest) => {
      const current = pendingRef.current
      if (!current) throw new Error('No transcription is pending')
      const apiKey = await providers.readKey(providers.settings.provider)
      if (!apiKey) {
        throw new Error('The API key is missing; add it under Providers')
      }
      return transcribe(current.provider, transcriptionRequest, {
        apiKey,
        signal: current.controller.signal,
      })
    },
    [providers],
  )

  return { pending, request, confirm, finish }
}
