import { useRef, useState } from 'react'
import { cleanUpLabel, type CleanUpProposal } from '../core/cleanUp'
import { useDialogFocus } from '../hooks/useDialogFocus'
import {
  buildCleanUpInput,
  CLEAN_UP_INSTRUCTIONS,
  CLEAN_UP_PROMPT_VERSION,
  type CleanUpRequest,
  type TextModelProvider,
} from '../providers/llm'
import './Dialog.css'

/** What the caller has and wants cleaned up. */
export interface CleanUpInput {
  /** The raw transcript; this is what is sent, never the edited body. */
  transcript: string
  kind: 'comment' | 'suggestion'
  /** The anchored passage, offered as an optional spelling hint. */
  quote: string | null
  /** The note's current text, which Accept replaces. */
  currentBody: string
}

/**
 * Asks for consent, runs the clean-up and lets the user review it. Resolves
 * with the accepted proposal, or null after Cancel or Discard.
 */
export type CleanUpFn = (input: CleanUpInput) => Promise<CleanUpProposal | null>

interface CleanUpDialogProps {
  input: CleanUpInput
  provider: TextModelProvider
  model: string
  language: string
  /** Runs the request; resolves with a checked proposal or rejects. */
  onConfirm: (request: CleanUpRequest) => Promise<CleanUpProposal>
  onAccept: (proposal: CleanUpProposal) => void
  /** Cancel, Discard, or Escape; while sending, the caller aborts. */
  onCancel: () => void
}

/**
 * Two steps. Consent: nothing leaves the device until "Send" is tapped, and
 * the text above it says what is sent, where, to which model, and with which
 * prompt. Review: the raw transcript and the proposal side by side; only
 * Accept changes the note.
 */
export function CleanUpDialog({
  input,
  provider,
  model,
  language,
  onConfirm,
  onAccept,
  onCancel,
}: CleanUpDialogProps) {
  const [includeQuote, setIncludeQuote] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<CleanUpProposal | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogFocus(dialogRef, onCancel)

  const request: CleanUpRequest = {
    transcript: input.transcript,
    kind: input.kind,
  }
  if (language) request.language = language
  if (includeQuote && input.quote) request.quote = input.quote

  async function send() {
    setSending(true)
    setError(null)
    try {
      setProposal(await onConfirm(request))
    } catch (err: unknown) {
      // An abort came from Cancel: the dialog is already closing.
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  if (proposal) {
    const replacesEdits =
      input.currentBody.trim() !== '' &&
      input.currentBody.trim() !== input.transcript.trim()
    return (
      <div className="dialog-backdrop">
        <div
          ref={dialogRef}
          className="dialog is-wide"
          role="dialog"
          aria-modal="true"
          aria-labelledby="clean-up-title"
        >
          <h2 id="clean-up-title">Review the clean-up</h2>
          <div className="dialog-compare">
            <section aria-label="Raw transcript">
              <h3>Raw transcript (kept as is)</h3>
              <p>{input.transcript}</p>
            </section>
            <section aria-label="Proposed text">
              <h3>Proposed by {cleanUpLabel(proposal.cleanUp)}</h3>
              <p>{proposal.text}</p>
            </section>
          </div>
          <p className="dialog-note">
            Accept puts the proposed text in the{' '}
            {input.kind === 'suggestion' ? 'replacement' : 'comment'} and marks
            it as cleaned up; the raw transcript stays as it is. Discard changes
            nothing.
          </p>
          {replacesEdits && (
            <p className="dialog-note" role="note">
              Accepting replaces the current text: <q>{input.currentBody}</q>
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" onClick={onCancel}>
              Discard
            </button>
            <button
              type="button"
              className="is-primary"
              onClick={() => onAccept(proposal)}
            >
              Accept
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="dialog-backdrop">
      <div
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clean-up-title"
      >
        <h2 id="clean-up-title">
          Clean up this transcript with {provider.name}?
        </h2>
        <p className="dialog-disclosure">
          {provider.describeUpload(request, model)}
        </p>
        <p className="dialog-note">
          The model is asked to fix punctuation, casing, fillers and technical
          terms only. You review the result before anything changes, and the raw
          transcript is always kept.
        </p>
        {input.quote && (
          <label className="dialog-check">
            <input
              type="checkbox"
              checked={includeQuote}
              disabled={sending}
              onChange={(e) => setIncludeQuote(e.target.checked)}
            />
            <span>
              Also send the quoted passage as a spelling hint:{' '}
              <q>{input.quote}</q>
            </span>
          </label>
        )}
        <details className="dialog-prompt">
          <summary>Prompt (version {CLEAN_UP_PROMPT_VERSION})</summary>
          <h3>Instructions</h3>
          <pre>{CLEAN_UP_INSTRUCTIONS}</pre>
          <h3>Message</h3>
          <pre>{buildCleanUpInput(request)}</pre>
        </details>
        {error && (
          <p role="alert" className="dialog-error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            {sending ? 'Cancel request' : 'Cancel'}
          </button>
          <button
            type="button"
            className="is-primary"
            onClick={() => void send()}
            disabled={sending}
          >
            {sending ? 'Cleaning up…' : `Send to ${provider.name}`}
          </button>
        </div>
      </div>
    </div>
  )
}
