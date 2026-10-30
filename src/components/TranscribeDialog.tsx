import { useRef, useState } from 'react'
import type { Transcript } from '../core/annotations'
import { formatDuration } from '../core/recording'
import { useDialogFocus } from '../hooks/useDialogFocus'
import type {
  SpeechToTextProvider,
  TranscriptionRequest,
} from '../providers/stt'
import './Dialog.css'

/** What the caller has and wants transcribed. */
export interface TranscriptionInput {
  audio: Blob
  mimeType: string
  durationMs: number
  /** The anchored passage, offered as an optional vocabulary hint. */
  quote: string | null
}

/**
 * Asks the user for consent and runs the upload. Resolves with null when the
 * user cancels, so callers can tell "no" from a failure.
 */
export type TranscribeFn = (
  input: TranscriptionInput,
) => Promise<Transcript | null>

interface TranscribeDialogProps {
  input: TranscriptionInput
  provider: SpeechToTextProvider
  language: string
  /** Runs the upload; resolves with the transcript or rejects. */
  onConfirm: (request: TranscriptionRequest) => Promise<Transcript>
  onDone: (transcript: Transcript) => void
  /** Also called while sending: the caller aborts the upload. */
  onCancel: () => void
}

/**
 * The consent step. Nothing leaves the device until "Send" is tapped here,
 * and the text above the button says exactly what will be sent and where.
 */
export function TranscribeDialog({
  input,
  provider,
  language,
  onConfirm,
  onDone,
  onCancel,
}: TranscribeDialogProps) {
  const [includeQuote, setIncludeQuote] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogFocus(dialogRef, onCancel)

  const request: TranscriptionRequest = {
    audio: input.audio,
    mimeType: input.mimeType,
  }
  if (language) request.language = language
  if (includeQuote && input.quote && provider.acceptsPrompt) {
    request.prompt = input.quote
  }

  async function send() {
    setSending(true)
    setError(null)
    try {
      onDone(await onConfirm(request))
    } catch (err: unknown) {
      // An abort came from Cancel: the dialog is already closing.
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : String(err))
      setSending(false)
    }
  }

  return (
    <div className="dialog-backdrop">
      <div
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transcribe-title"
      >
        <h2 id="transcribe-title">Send this recording to {provider.name}?</h2>
        <p className="dialog-disclosure">{provider.describeUpload(request)}</p>
        <p className="dialog-note">
          Recording length {formatDuration(input.durationMs)}. The raw
          transcript is kept as returned; you can edit the comment text
          afterwards.
        </p>
        {input.quote && provider.acceptsPrompt && (
          <label className="dialog-check">
            <input
              type="checkbox"
              checked={includeQuote}
              disabled={sending}
              onChange={(e) => setIncludeQuote(e.target.checked)}
            />
            <span>
              Also send the quoted passage as a vocabulary hint:{' '}
              <q>{input.quote}</q>
            </span>
          </label>
        )}
        {error && (
          <p role="alert" className="dialog-error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            {sending ? 'Cancel upload' : 'Cancel'}
          </button>
          <button
            type="button"
            className="is-primary"
            onClick={() => void send()}
            disabled={sending}
          >
            {sending ? 'Transcribing…' : `Send to ${provider.name}`}
          </button>
        </div>
      </div>
    </div>
  )
}
