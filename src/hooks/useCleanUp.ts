import { useCallback, useEffect, useRef, useState } from 'react'
import type { CleanUpProposal } from '../core/cleanUp'
import type { CleanUpFn, CleanUpInput } from '../components/CleanUpDialog'
import {
  cleanUp,
  type CleanUpRequest,
  type TextModelProvider,
} from '../providers/llm'
import {
  createTextProvider,
  PROVIDER_LABELS,
  type TextProviderId,
} from '../providers/registry'
import type { Providers } from './useProviders'

/** A clean-up waiting for the user's consent, then their Accept. */
export interface PendingCleanUp {
  /** Distinct per request; the dialog is keyed by it. */
  id: number
  input: CleanUpInput
  provider: TextModelProvider
  model: string
}

export interface CleanUpFlow {
  /** The request the dialog should show, if any. */
  pending: PendingCleanUp | null
  /**
   * Opens the consent step. Resolves with the proposal the user accepted,
   * with null after Cancel or Discard (or when the document changes), and
   * rejects when no key is stored or another request is already waiting.
   */
  request: CleanUpFn
  /** Sends the pending request; called by the dialog's Send. */
  confirm: (request: CleanUpRequest) => Promise<CleanUpProposal>
  /**
   * Settles the pending request; null aborts a request in flight. With
   * `target`, only that request is settled: a late answer for a request
   * already cancelled is dropped rather than handed to the next one.
   */
  finish: (proposal: CleanUpProposal | null, target?: PendingCleanUp) => void
}

interface Pending extends PendingCleanUp {
  providerId: TextProviderId
  resolve: (proposal: CleanUpProposal | null) => void
  controller: AbortController
}

/**
 * Consent-gated clean-up, the sibling of useTranscription with the same
 * guarantees: nothing contacts a provider until `confirm` runs, `confirm` is
 * only reachable from the dialog, and one request at a time.
 */
export function useCleanUp(
  providers: Providers,
  createProviderImpl: (
    provider: TextProviderId,
  ) => TextModelProvider = createTextProvider,
): CleanUpFlow {
  const [pending, setPending] = useState<Pending | null>(null)
  const pendingRef = useRef<Pending | null>(null)
  const nextId = useRef(1)

  const finish = useCallback(
    (proposal: CleanUpProposal | null, target?: PendingCleanUp) => {
      const current = pendingRef.current
      if (!current) return
      if (target && target.id !== current.id) return
      pendingRef.current = null
      setPending(null)
      if (proposal === null) current.controller.abort()
      current.resolve(proposal)
    },
    [],
  )

  // Unmount settles whatever is waiting, so no caller hangs.
  useEffect(() => () => finish(null), [finish])

  const request = useCallback<CleanUpFn>(
    (input) =>
      new Promise((resolve, reject) => {
        if (pendingRef.current) {
          reject(new Error('Another clean-up is waiting for your confirmation'))
          return
        }
        const { textSettings } = providers
        if (!providers.ready) {
          reject(new Error('Provider keys are not ready yet'))
          return
        }
        if (input.transcript.trim() === '') {
          reject(new Error('There is no raw transcript to clean up'))
          return
        }
        if (!providers.hasKey(textSettings.provider)) {
          reject(
            new Error(
              `Add your ${PROVIDER_LABELS[textSettings.provider]} API key under Providers first`,
            ),
          )
          return
        }
        let provider: TextModelProvider
        try {
          provider = createProviderImpl(textSettings.provider)
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
    async (cleanUpRequest: CleanUpRequest) => {
      const current = pendingRef.current
      if (!current) throw new Error('No clean-up is pending')
      const apiKey = await providers.readKey(current.providerId)
      if (!apiKey) {
        throw new Error('The API key is missing; add it under Providers')
      }
      return cleanUp(current.provider, cleanUpRequest, {
        apiKey,
        model: current.model,
        signal: current.controller.signal,
      })
    },
    [providers],
  )

  return { pending, request, confirm, finish }
}
