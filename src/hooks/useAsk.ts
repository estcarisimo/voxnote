import { useCallback, useEffect, useRef, useState } from 'react'
import type { Answer } from '../core/annotations'
import { ask, type AskRequest } from '../core/ask'
import { hostOf, type LocalServer } from '../providers/local'
import type { TextModelProvider } from '../providers/llm'
import {
  createTextProvider,
  isLocalProviderId,
  PROVIDER_LABELS,
  type TextProviderId,
} from '../providers/registry'
import type { Providers } from './useProviders'

/** What the caller has: the question, the passage and what may go with it. */
export interface AskInput {
  question: string
  quote: string
  /** Where the passage is, e.g. "page 3" or "block 12". */
  place: string
  /**
   * The document text around the passage, already cut to size; null when
   * it could not be found. Sent only when the reviewer ticks it.
   */
  surrounding: string | null
  /** Earlier questions and answers on the same comment, oldest first. */
  earlier: readonly Pick<Answer, 'question' | 'text'>[]
}

/** Resolves with the answer the user kept, or null after Cancel/Discard. */
export type AskFn = (input: AskInput) => Promise<Answer | null>

/** A question waiting for the user's consent, then their Keep. */
export interface PendingAsk {
  /** Distinct per request; the dialog is keyed by it. */
  id: number
  input: AskInput
  provider: TextModelProvider
  model: string
}

export interface AskFlow {
  pending: PendingAsk | null
  /**
   * Opens the consent step. Rejects when no key is stored or another
   * request is already waiting.
   */
  request: AskFn
  /** Sends the pending request; called by the dialog's Send. */
  confirm: (request: AskRequest) => Promise<Answer>
  /**
   * Settles the pending request; null aborts a request in flight. With
   * `target`, only that request is settled.
   */
  finish: (answer: Answer | null, target?: PendingAsk) => void
}

interface Pending extends PendingAsk {
  providerId: TextProviderId
  resolve: (answer: Answer | null) => void
  controller: AbortController
}

/**
 * Consent-gated questions, the sibling of useCleanUp with the same
 * guarantees: nothing contacts a provider until `confirm` runs, `confirm` is
 * only reachable from the dialog, and one request at a time. It uses the
 * text model chosen for Polish in AI keys.
 */
export function useAsk(
  providers: Providers,
  createProviderImpl: (
    provider: TextProviderId,
    local?: LocalServer,
  ) => TextModelProvider = createTextProvider,
): AskFlow {
  const [pending, setPending] = useState<Pending | null>(null)
  const pendingRef = useRef<Pending | null>(null)
  const nextId = useRef(1)

  const finish = useCallback((answer: Answer | null, target?: PendingAsk) => {
    const current = pendingRef.current
    if (!current) return
    if (target && target.id !== current.id) return
    pendingRef.current = null
    setPending(null)
    if (answer === null) current.controller.abort()
    current.resolve(answer)
  }, [])

  // Unmount settles whatever is waiting, so no caller hangs.
  useEffect(() => () => finish(null), [finish])

  const request = useCallback<AskFn>(
    (input) =>
      new Promise((resolve, reject) => {
        if (pendingRef.current) {
          reject(new Error('Another request is waiting for your confirmation'))
          return
        }
        const { textSettings } = providers
        if (!providers.ready) {
          reject(new Error('AI keys are not ready yet'))
          return
        }
        if (input.question.trim() === '') {
          reject(new Error('Write the question in the comment first'))
          return
        }
        if (!providers.hasKey(textSettings.provider)) {
          reject(
            new Error(
              `Add your ${PROVIDER_LABELS[textSettings.provider]} key in AI keys first`,
            ),
          )
          return
        }
        let provider: TextModelProvider
        try {
          provider = createProviderImpl(
            textSettings.provider,
            textSettings.local,
          )
        } catch (err: unknown) {
          reject(err instanceof Error ? err : new Error(String(err)))
          return
        }
        const next: Pending = {
          id: nextId.current++,
          input,
          provider,
          providerId: textSettings.provider,
          model: textSettings.model,
          resolve,
          controller: new AbortController(),
        }
        pendingRef.current = next
        setPending(next)
      }),
    [providers, createProviderImpl],
  )

  const confirm = useCallback(
    async (askRequest: AskRequest) => {
      const current = pendingRef.current
      if (!current) throw new Error('No question is pending')
      const apiKey = await providers.readKey(current.providerId)
      // A local server set up again while the dialog was open may have a new
      // address and key: never send that key to the host the dialog named.
      const local = providers.textSettings.local
      if (
        isLocalProviderId(current.providerId) &&
        (!local || hostOf(local.baseUrl) !== current.provider.endpointHost)
      ) {
        throw new Error(
          'The local server changed after this dialog opened; try again',
        )
      }
      if (
        apiKey === null ||
        (apiKey === '' && !isLocalProviderId(current.providerId))
      ) {
        throw new Error('The key is missing; add it in AI keys')
      }
      return ask(current.provider, askRequest, {
        apiKey,
        model: current.model,
        signal: current.controller.signal,
      })
    },
    [providers],
  )

  return { pending, request, confirm, finish }
}
