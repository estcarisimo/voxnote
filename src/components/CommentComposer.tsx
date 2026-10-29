import { useState, type FormEvent } from 'react'
import type { VoiceNote } from '../core/annotations'
import { formatDuration } from '../core/recording'
import type { VoiceRecorder } from '../hooks/useVoiceRecorder'
import type { ToolbarPlacement } from './SelectionToolbar'
import './CommentComposer.css'

export interface CommentDraft {
  body: string
  voice?: VoiceNote
  audio?: Blob
}

interface CommentComposerProps {
  placement: ToolbarPlacement
  /** The anchored passage, shown so the user sees what the note refers to. */
  quote: string | null
  /** When set, the composer shows recording controls. */
  recorder: VoiceRecorder | null
  onSave: (draft: CommentDraft) => Promise<void>
  onCancel: () => void
}

/**
 * Writes a comment for a pending anchor: typed text, a voice recording, or
 * both. Saving a voice note keeps the audio on this device; transcription is
 * a separate step that needs a provider and explicit consent.
 */
export function CommentComposer({
  placement,
  quote,
  recorder,
  onSave,
  onCancel,
}: CommentComposerProps) {
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recording =
    recorder?.state.status === 'recorded' ? recorder.state.recording : null
  const busy =
    recorder?.state.status === 'recording' ||
    recorder?.state.status === 'requesting'
  const canSave = !saving && !busy && (body.trim() !== '' || recording !== null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSave) return
    setSaving(true)
    setError(null)
    const draft: CommentDraft = { body }
    if (recording) {
      draft.voice = {
        mimeType: recording.mimeType,
        durationMs: Math.round(recording.durationMs),
        recordedAt: recording.recordedAt,
      }
      draft.audio = recording.blob
    }
    try {
      await onSave(draft)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <form
      className="comment-composer"
      aria-label="New comment"
      style={{ left: placement.left, top: placement.bottom }}
      onSubmit={submit}
    >
      {quote && (
        <blockquote className="comment-composer-quote">{quote}</blockquote>
      )}
      {recorder && <RecorderControls recorder={recorder} />}
      <textarea
        aria-label="Comment"
        placeholder={
          recorder ? 'Add text (optional)' : 'What should the author know?'
        }
        rows={3}
        value={body}
        autoFocus={!recorder}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.currentTarget.form?.requestSubmit()
          }
        }}
      />
      {error && (
        <p role="alert" className="comment-composer-error">
          {error}
        </p>
      )}
      <div className="comment-composer-actions">
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="is-primary" disabled={!canSave}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

function RecorderControls({ recorder }: { recorder: VoiceRecorder }) {
  const { state } = recorder
  switch (state.status) {
    case 'idle':
      return (
        <div className="comment-composer-recorder">
          <button type="button" onClick={() => void recorder.start()}>
            ● Record
          </button>
        </div>
      )
    case 'requesting':
      return (
        <div className="comment-composer-recorder" aria-live="polite">
          <span>Waiting for microphone access…</span>
        </div>
      )
    case 'recording':
      return (
        <div className="comment-composer-recorder" aria-live="polite">
          <span className="comment-composer-live">
            ● Recording {formatDuration(recorder.elapsedMs)}
          </span>
          <button type="button" onClick={recorder.stop}>
            ■ Stop
          </button>
        </div>
      )
    case 'recorded':
      return (
        <div className="comment-composer-recorder">
          <audio controls src={state.recording.url} />
          <span>{formatDuration(state.recording.durationMs)}</span>
          <button type="button" onClick={recorder.discard}>
            Re-record
          </button>
          <p className="comment-composer-note">
            The recording stays on this device. Transcription will need a
            speech-to-text provider and your consent.
          </p>
        </div>
      )
    case 'error':
      return (
        <div className="comment-composer-recorder">
          <p role="alert" className="comment-composer-error">
            {state.message}
          </p>
          <button type="button" onClick={recorder.discard}>
            Dismiss
          </button>
        </div>
      )
  }
}
