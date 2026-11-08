import { useRef, useState } from 'react'
import { quoteOf, type Annotation } from '../core/annotations'
import type {
  ImportSummary,
  MergePlan,
  NotesFile,
  Resolutions,
} from '../core/importNotes'
import { placeLabel } from '../core/review'
import { useDialogFocus } from '../hooks/useDialogFocus'
import './Dialog.css'
import './ImportNotesDialog.css'

interface ImportNotesDialogProps {
  /** The file name the notes were read from. */
  fileName: string
  notes: NotesFile
  plan: MergePlan
  /** True when the document the notes belong to is the one open now. */
  documentOpen: boolean
  /** Writes the plan with these choices; rejects with the reason it failed. */
  onApply: (resolutions: Resolutions) => Promise<ImportSummary>
  /** Asks for the document's file; offered when it is not the one open. */
  onOpenDocument: () => void
  onClose: () => void
}

/**
 * Confirms an import before anything is written: what the file holds, what
 * is new, what is already here and, for each record that differs, which
 * side to keep. Then says what was done.
 */
export function ImportNotesDialog({
  fileName,
  notes,
  plan,
  documentOpen,
  onApply,
  onOpenDocument,
  onClose,
}: ImportNotesDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [choices, setChoices] = useState<Record<string, 'mine' | 'theirs'>>(
    () => Object.fromEntries(plan.conflicts.map((c) => [c.theirs.id, 'mine'])),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  useDialogFocus(dialogRef, () => {
    if (!busy) onClose()
  })

  const name = notes.document.name
  const voiceNotes = notes.annotations.filter(
    (a) => a.kind !== 'highlight' && a.voice,
  ).length
  const nothingToDo = plan.added.length === 0 && plan.conflicts.length === 0

  async function apply() {
    setBusy(true)
    setError(null)
    try {
      setSummary(await onApply(choices))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (summary) {
    return (
      <div className="dialog-backdrop">
        <div
          ref={dialogRef}
          className="dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-notes-title"
        >
          <h2 id="import-notes-title">Notes imported</h2>
          <ul className="dialog-list" aria-label="Import summary">
            <li>Added: {summary.added}</li>
            <li>Skipped, already here: {summary.skipped}</li>
            <li>
              Conflicts: {summary.conflicts}
              {summary.conflicts > 0 &&
                ` (kept yours: ${summary.keptMine}, took the file's: ${summary.tookFile})`}
            </li>
          </ul>
          {summary.withoutRecording > 0 && (
            <p className="dialog-note">
              {summary.withoutRecording === 1
                ? '1 voice note has'
                : `${summary.withoutRecording} voice notes have`}{' '}
              no recording in this browser: notes files carry the transcript,
              not the audio.
            </p>
          )}
          {!documentOpen && (
            <p className="dialog-note">
              They are stored for <q>{name}</q>. Open that file to see them.
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Close
            </button>
            {!documentOpen && (
              <button
                type="button"
                className="is-primary"
                onClick={onOpenDocument}
              >
                Open {name}…
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="dialog-backdrop">
      <div
        ref={dialogRef}
        className={`dialog${plan.conflicts.length > 0 ? ' is-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-notes-title"
      >
        <h2 id="import-notes-title">Import notes for {name}?</h2>
        <p className="dialog-note">
          <q>{fileName}</q> was exported {notes.exportedAt} (UTC)
          {notes.appVersion && ` by VoxNote ${notes.appVersion}`}. It holds{' '}
          {count(notes.annotations.length, 'annotation')} for <q>{name}</q>
          {notes.document.size !== null &&
            ` (${notes.document.size.toLocaleString('en-US')} bytes)`}
          , SHA-256 <code>{notes.document.id.slice(0, 12)}…</code>.
        </p>
        {!documentOpen && (
          <p className="dialog-disclosure">
            That document is not open. The notes are stored in this browser;
            open <q>{name}</q> afterwards to see them.
          </p>
        )}
        <ul className="dialog-list" aria-label="What the file holds">
          <li>New: {plan.added.length}</li>
          <li>Already here, identical (skipped): {plan.identical.length}</li>
          <li>Here, but different: {plan.conflicts.length}</li>
        </ul>
        {voiceNotes > 0 && (
          <p className="dialog-note">
            Recordings are not part of a notes file; voice notes come with their
            transcript.
          </p>
        )}
        {plan.conflicts.map(({ mine, theirs }) => (
          <fieldset key={theirs.id} className="import-conflict">
            <legend>{describe(mine)}</legend>
            <div className="dialog-compare">
              <label>
                <input
                  type="radio"
                  name={`conflict-${theirs.id}`}
                  checked={choices[theirs.id] === 'mine'}
                  onChange={() =>
                    setChoices((c) => ({ ...c, [theirs.id]: 'mine' }))
                  }
                />{' '}
                <strong>Keep mine</strong>, updated {mine.updatedAt} (UTC)
                <span className="import-conflict-text">{content(mine)}</span>
              </label>
              <label>
                <input
                  type="radio"
                  name={`conflict-${theirs.id}`}
                  checked={choices[theirs.id] === 'theirs'}
                  onChange={() =>
                    setChoices((c) => ({ ...c, [theirs.id]: 'theirs' }))
                  }
                />{' '}
                <strong>Take the file’s</strong>, updated {theirs.updatedAt}{' '}
                (UTC)
                <span className="import-conflict-text">{content(theirs)}</span>
              </label>
            </div>
          </fieldset>
        ))}
        {error && (
          <p role="alert" className="dialog-error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="is-primary"
            onClick={() => void apply()}
            disabled={busy}
          >
            {busy ? 'Importing…' : nothingToDo ? 'Done' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  )
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

const KIND = {
  highlight: 'Highlight',
  comment: 'Comment',
  suggestion: 'Suggestion',
} as const

/** "Comment, Page 2: “the result”". */
function describe(a: Annotation): string {
  const quote = quoteOf(a.anchor)
  const passage = quote ? `: “${shorten(quote)}”` : ', region'
  return `${KIND[a.kind]}, ${placeLabel(a.anchor)}${passage}`
}

/** What differs most often: the body, the color, the visibility. */
function content(a: Annotation): string {
  const parts: string[] = []
  if (a.kind === 'highlight') parts.push(`color ${a.color}`)
  else if (a.body.trim() !== '') parts.push(a.body)
  else parts.push('(dictated, not transcribed)')
  parts.push(a.visibility === 'private' ? 'private' : 'for the author')
  return parts.join(' · ')
}

function shorten(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}
