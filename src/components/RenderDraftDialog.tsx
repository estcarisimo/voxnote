import { useEffect, useRef, useState } from 'react'
import {
  AUTHOR_TOOLS_HOST,
  describeDraftUpload,
  renderDraftPdf,
  type RenderedDraft,
} from '../core/remotePdf'
import { useDialogFocus } from '../hooks/useDialogFocus'
import './Dialog.css'

interface RenderDraftDialogProps {
  xml: File
  /** The compiled PDF, ready to open. */
  onDone: (pdf: File) => void
  /** Cancel, Discard or Escape; while uploading, the request is aborted. */
  onCancel: () => void
}

const AUTHOR_TOOLS_LABEL = new URL(AUTHOR_TOOLS_HOST).host

/**
 * Compiles an Internet-Draft's XML into a PDF with the IETF's author tools.
 * Consent first: nothing leaves the device until "Send" is tapped, and the
 * text above it says what is uploaded and where. When xml2rfc reports
 * warnings, they are shown before the PDF opens; they are never hidden.
 */
export function RenderDraftDialog({
  xml,
  onDone,
  onCancel,
}: RenderDraftDialogProps) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RenderedDraft | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<AbortController | null>(null)
  useDialogFocus(dialogRef, cancel)

  // Unmounting while a request runs (the document closed) aborts it.
  useEffect(() => () => controllerRef.current?.abort(), [])

  function cancel() {
    controllerRef.current?.abort()
    onCancel()
  }

  async function send() {
    const controller = new AbortController()
    controllerRef.current = controller
    setSending(true)
    setError(null)
    try {
      const rendered = await renderDraftPdf(
        xml,
        (input, init) => fetch(input, init),
        controller.signal,
      )
      if (controller.signal.aborted) return
      if (rendered.warnings.length === 0) onDone(rendered.pdf)
      else setResult(rendered)
    } catch (err: unknown) {
      if (controller.signal.aborted) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      controllerRef.current = null
      setSending(false)
    }
  }

  if (result) {
    return (
      <div className="dialog-backdrop">
        <div
          ref={dialogRef}
          className="dialog is-wide"
          role="dialog"
          aria-modal="true"
          aria-labelledby="render-draft-title"
        >
          <h2 id="render-draft-title">The draft compiled, with warnings</h2>
          <p className="dialog-note">
            xml2rfc reported these while compiling <q>{xml.name}</q>. The PDF is
            ready; the warnings may mean parts of it differ from the published
            version.
          </p>
          <ul className="dialog-list" aria-label="xml2rfc warnings">
            {result.warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
          <div className="dialog-actions">
            <button type="button" onClick={onCancel}>
              Discard
            </button>
            <button
              type="button"
              className="is-primary"
              onClick={() => onDone(result.pdf)}
            >
              Open the PDF
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
        aria-labelledby="render-draft-title"
      >
        <h2 id="render-draft-title">
          Compile this Internet-Draft with {AUTHOR_TOOLS_LABEL}?
        </h2>
        <p className="dialog-disclosure">{describeDraftUpload(xml)}</p>
        <p className="dialog-note">
          VoxNote has no server of its own and is not affiliated with the IETF.
          The PDF opens here once it comes back; the XML is not kept.
        </p>
        {error && (
          <p role="alert" className="dialog-error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={cancel}>
            {sending ? 'Cancel request' : 'Cancel'}
          </button>
          <button
            type="button"
            className="is-primary"
            onClick={() => void send()}
            disabled={sending}
          >
            {sending ? 'Compiling…' : `Send to ${AUTHOR_TOOLS_LABEL}`}
          </button>
        </div>
      </div>
    </div>
  )
}
