import { useRef, useState } from 'react'
import type { Answer } from '../core/annotations'
import {
  answerLabel,
  ASK_INSTRUCTIONS,
  ASK_PROMPT_VERSION,
  buildAskInput,
  describeAskUpload,
  type AskRequest,
} from '../core/ask'
import { useDialogFocus } from '../hooks/useDialogFocus'
import type { AskInput } from '../hooks/useAsk'
import type { TextModelProvider } from '../providers/llm'
import './Dialog.css'

interface AskDialogProps {
  input: AskInput
  provider: TextModelProvider
  model: string
  language: string
  /** Runs the request; resolves with a checked answer or rejects. */
  onConfirm: (request: AskRequest) => Promise<Answer>
  onKeep: (answer: Answer) => void
  /** Cancel, Discard, or Escape; while sending, the caller aborts. */
  onCancel: () => void
}

/**
 * Two steps. Consent: nothing leaves the device until "Send" is tapped, and
 * the text above it says what is sent, where, to which model, and with which
 * prompt. Answer: shown with who wrote it; only Keep stores it beside the
 * comment, and the comment's text never changes.
 */
export function AskDialog({
  input,
  provider,
  model,
  language,
  onConfirm,
  onKeep,
  onCancel,
}: AskDialogProps) {
  const [includeSurrounding, setIncludeSurrounding] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogFocus(dialogRef, onCancel)

  const request: AskRequest = { question: input.question, quote: input.quote }
  if (language) request.language = language
  if (includeSurrounding && input.surrounding) {
    request.surrounding = { text: input.surrounding, place: input.place }
  }
  if (input.earlier.length > 0) request.earlier = input.earlier

  async function send() {
    setSending(true)
    setError(null)
    try {
      setAnswer(await onConfirm(request))
    } catch (err: unknown) {
      // An abort came from Cancel: the dialog is already closing.
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  if (answer) {
    return (
      <div className="dialog-backdrop">
        <div
          ref={dialogRef}
          className="dialog is-wide"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ask-title"
        >
          <h2 id="ask-title">Answer from {answerLabel(answer)}</h2>
          <p className="dialog-note">
            <strong>Your question:</strong> {answer.question}
          </p>
          <section aria-label="Answer" className="dialog-answer">
            {answer.text}
          </section>
          <p className="dialog-note">
            Written by a model, not by you, and it can be wrong. Keep stores it
            under the comment, marks the comment private and leaves its text as
            it is; the Markdown report and the annotated PDF leave answers out.
            Discard stores nothing.
          </p>
          <div className="dialog-actions">
            <button type="button" onClick={onCancel}>
              Discard
            </button>
            <button
              type="button"
              className="is-primary"
              onClick={() => onKeep(answer)}
            >
              Keep
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
        aria-labelledby="ask-title"
      >
        <h2 id="ask-title">Ask {provider.name} about this passage?</h2>
        <p className="dialog-disclosure">
          {describeAskUpload(provider, request, model)}
        </p>
        <p className="dialog-note">
          The model is asked to explain the passage, to say when it cannot tell,
          and not to judge the manuscript or write review text. You read the
          answer before anything is stored.
        </p>
        {input.surrounding ? (
          <label className="dialog-check">
            <input
              type="checkbox"
              checked={includeSurrounding}
              disabled={sending}
              onChange={(e) => setIncludeSurrounding(e.target.checked)}
            />
            <span>
              Also send the text around the passage ({input.surrounding.length}{' '}
              characters from {input.place}). Helps when a term is defined
              nearby; it sends more of the document.
            </span>
          </label>
        ) : (
          <p className="dialog-note">
            The text around the passage could not be found on {input.place}, so
            only the passage is offered.
          </p>
        )}
        <details className="dialog-prompt">
          <summary>Prompt (version {ASK_PROMPT_VERSION})</summary>
          <h3>Instructions</h3>
          <pre>{ASK_INSTRUCTIONS}</pre>
          <h3>Message</h3>
          <pre>{buildAskInput(request)}</pre>
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
            {sending ? 'Asking…' : `Send to ${provider.name}`}
          </button>
        </div>
      </div>
    </div>
  )
}
