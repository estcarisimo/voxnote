import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Transcript } from '../core/annotations'
import {
  createConsent,
  isConsentValid,
  standingConsentSentence,
  type AutoTranscribeConsent,
} from '../core/autoTranscribe'
import type {
  TranscribeFn,
  TranscriptionInput,
} from '../components/TranscribeDialog'
import {
  createProvider,
  PROVIDER_LABELS,
  type SttProviderId,
  type SttSettings,
} from '../providers/registry'
import {
  transcribe,
  type SpeechToTextProvider,
  type TranscriptionRequest,
} from '../providers/stt'
import type { AutoTranscribeStore } from './useAutoTranscribeConsent'
import type { Providers } from './useProviders'

/** An upload waiting for the user's consent, or running under a standing one. */
export interface PendingUpload {
  /** Distinct per request; the dialog is keyed by it. */
  id: number
  input: TranscriptionInput
  provider: SpeechToTextProvider
  /** Sent on Stop under a standing consent: no dialog is shown. */
  automatic: boolean
  /** The dialog may offer "Also do this automatically for this document". */
  offerStanding: boolean
}

export interface ConfirmOptions {
  /** The user ticked "Also do this automatically for this document". */
  standing?: boolean
}

/** The open document's standing consent, as the composer shows it. */
export interface AutoTranscribeState {
  active: boolean
  /** The consent in force, for its wording and grant time. */
  consent: AutoTranscribeConsent | null
  revoke: () => void
}

export interface TranscriptionFlow {
  /** The upload in progress or waiting for consent, if any. */
  pending: PendingUpload | null
  /**
   * Opens the consent step, or with `automatic` sends at once under the
   * open document's standing consent. Resolves with the transcript, with
   * null after Cancel (or when the document changes), and rejects when no
   * key is stored, another request is already pending, an automatic request
   * has no valid consent, or an automatic upload fails.
   */
  request: TranscribeFn
  /** Runs the upload for the pending request; called by the dialog's Send. */
  confirm: (
    request: TranscriptionRequest,
    options?: ConfirmOptions,
  ) => Promise<Transcript>
  /**
   * Settles the pending request; null aborts an upload in flight. With
   * `target`, only that request is settled: a result that arrives for a
   * request already cancelled is dropped rather than handed to the next one.
   */
  finish: (transcript: Transcript | null, target?: PendingUpload) => void
  /** Null when no document is open. */
  auto: AutoTranscribeState | null
}

interface Pending extends PendingUpload {
  /** Whose key to read at Send: fixed when the dialog opened. */
  providerId: SttProviderId
  resolve: (transcript: Transcript | null) => void
  controller: AbortController
}

/** The open document and where its standing consents are kept. */
export interface AutoTranscribeContext {
  documentId: string | null
  store: AutoTranscribeStore
}

/**
 * Consent-gated transcription. A provider is contacted only from `confirm`,
 * which the dialog's Send calls, or from an automatic request, which needs
 * a standing consent the user granted in that dialog for this document,
 * provider, model, host and language. Both share one pending slot: a second
 * request is refused rather than silently orphaning the first, abort works
 * the same way, and a document switch settles either.
 */
export function useTranscription(
  providers: Providers,
  autoContext: AutoTranscribeContext | null = null,
  createProviderImpl: (
    settings: SttSettings,
  ) => SpeechToTextProvider = createProvider,
): TranscriptionFlow {
  const [pending, setPending] = useState<Pending | null>(null)
  const pendingRef = useRef<Pending | null>(null)
  const nextId = useRef(1)
  const documentId = autoContext?.documentId ?? null
  const consentStore = autoContext?.store ?? null

  const finish = useCallback(
    (transcript: Transcript | null, target?: PendingUpload) => {
      const current = pendingRef.current
      if (!current) return
      if (target && target.id !== current.id) return
      pendingRef.current = null
      setPending(null)
      if (transcript === null) current.controller.abort()
      current.resolve(transcript)
    },
    [],
  )

  // Unmount settles whatever is waiting, so no caller hangs.
  useEffect(() => () => finish(null), [finish])

  /** The consent that applies to the open document now, if any. */
  const validConsent = useCallback(
    (provider: SpeechToTextProvider): AutoTranscribeConsent | null => {
      if (!documentId || !consentStore) return null
      const consent = consentStore.consents[documentId]
      const { settings } = providers
      return isConsentValid(consent, {
        documentId,
        provider: settings.provider,
        model: settings.model,
        host: provider.endpointHost,
        language: settings.language,
      })
        ? consent
        : null
    },
    [documentId, consentStore, providers],
  )

  const upload = useCallback(
    async (current: Pending, transcriptionRequest: TranscriptionRequest) => {
      // The key of the provider the disclosure named, never the one the
      // settings name now: a key only goes to its own host.
      if (current.provider.id !== current.providerId) {
        throw new Error(
          `Provider mismatch: ${current.provider.id} is not ${current.providerId}`,
        )
      }
      const apiKey = await providers.readKey(current.providerId)
      if (!apiKey) {
        throw new Error('The key is missing; add it in AI keys')
      }
      return transcribe(current.provider, transcriptionRequest, {
        apiKey,
        signal: current.controller.signal,
      })
    },
    [providers],
  )

  const request = useCallback<TranscribeFn>(
    (input, options = {}) =>
      new Promise((resolve, reject) => {
        if (pendingRef.current) {
          reject(
            new Error(
              pendingRef.current.automatic
                ? 'Another recording is still being transcribed'
                : 'Another transcription is waiting for your confirmation',
            ),
          )
          return
        }
        const { settings } = providers
        if (!providers.ready) {
          reject(new Error('AI keys are not ready yet'))
          return
        }
        if (!providers.hasKey(settings.provider)) {
          reject(
            new Error(
              `Add your ${PROVIDER_LABELS[settings.provider]} key in AI keys first`,
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
        if (options.signal?.aborted) {
          resolve(null)
          return
        }
        const consent = validConsent(provider)
        if (options.automatic && !consent) {
          reject(
            new Error(
              'Auto-transcribe is off for this document; tap Transcribe… to send this recording',
            ),
          )
          return
        }
        const next: Pending = {
          id: nextId.current++,
          input,
          provider,
          providerId: settings.provider,
          automatic: options.automatic === true,
          offerStanding:
            documentId !== null && consentStore !== null && !consent,
          resolve,
          controller: new AbortController(),
        }
        pendingRef.current = next
        setPending(next)
        options.signal?.addEventListener('abort', () => finish(null, next), {
          once: true,
        })
        if (!next.automatic || !consent) return

        const automaticRequest: TranscriptionRequest = {
          audio: input.audio,
          mimeType: input.mimeType,
        }
        if (settings.language) automaticRequest.language = settings.language
        if (consent.includeQuote && input.quote && provider.acceptsPrompt) {
          automaticRequest.prompt = input.quote
        }
        upload(next, automaticRequest).then(
          (transcript) => finish(transcript, next),
          (err: unknown) => {
            // A cancel already settled it with null.
            if (pendingRef.current !== next) return
            pendingRef.current = null
            setPending(null)
            reject(err instanceof Error ? err : new Error(String(err)))
          },
        )
      }),
    [
      providers,
      createProviderImpl,
      validConsent,
      documentId,
      consentStore,
      finish,
      upload,
    ],
  )

  const confirm = useCallback(
    async (
      transcriptionRequest: TranscriptionRequest,
      options: ConfirmOptions = {},
    ) => {
      const current = pendingRef.current
      if (!current) throw new Error('No transcription is pending')
      if (options.standing) {
        if (!current.offerStanding || !documentId || !consentStore) {
          throw new Error('Auto-transcribe cannot be turned on here')
        }
        const { settings } = providers
        consentStore.grant(
          createConsent({
            documentId,
            provider: current.providerId,
            model: settings.model,
            host: current.provider.endpointHost,
            language: settings.language,
            includeQuote: transcriptionRequest.prompt !== undefined,
            disclosure: `${current.provider.describeUpload(transcriptionRequest)} ${standingConsentSentence(current.provider.name, current.provider.endpointHost)}`,
          }),
        )
      }
      return upload(current, transcriptionRequest)
    },
    [providers, documentId, consentStore, upload],
  )

  const auto = useMemo<AutoTranscribeState | null>(() => {
    if (!documentId || !consentStore) return null
    let consent: AutoTranscribeConsent | null = null
    try {
      consent = validConsent(createProviderImpl(providers.settings))
    } catch {
      // A provider that cannot be built cannot have a valid consent; the
      // request path reports the error when the user tries.
      consent = null
    }
    return {
      active: consent !== null,
      consent,
      revoke: () => consentStore.revoke(documentId),
    }
  }, [documentId, consentStore, validConsent, createProviderImpl, providers])

  return { pending, request, confirm, finish, auto }
}
