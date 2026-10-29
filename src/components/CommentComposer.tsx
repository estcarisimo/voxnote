import { useState, type FormEvent } from 'react'
import type { Transcript, VoiceNote } from '../core/annotations'
import { formatDuration } from '../core/recording'
import type { Recording, VoiceRecorder } from '../hooks/useVoiceRecorder'
import type { ToolbarPlacement } from './SelectionToolbar'
import type { TranscribeFn } from './TranscribeDialog'
import './CommentComposer.css'

export interface CommentDraft {
  body: string
  voice?: VoiceNote
  audio?: Blob
}

export type ComposerMode = 'comment' | 'suggestion'

interface CommentComposerProps {
  placement: ToolbarPlacement
  /** A comment says something about the passage; a suggestion replaces it. */
  mode: ComposerMode
  /** The anchored passage, shown so the user sees what the note refers to. */
  quote: string | null
  /** When set, the composer shows recording controls. */
  recorder: VoiceRecorder | null
  /** Opens the consent dialog and transcribes; null when unavailable. */
  transcribe: TranscribeFn | null
  onSave: (draft: CommentDraft) => Promise<void>
  onCancel: () => void
}

/** A transcript belongs to one recording; re-recording drops it. */
interface Transcribed {
  url: string
  transcript: Transcript
}

/**
 * Writes a comment or a suggestion for a pending anchor: typed text, a voice
 * recording, or both. A suggestion starts from the selected text so it can
 * be edited in place, Google Docs style; saving needs an actual change.
 * Saving a voice note keeps the audio on this device; transcription is a
 * separate step that needs a provider and explicit consent.
 */
export function CommentComposer({
  placement,
  mode,
  quote,
  recorder,
  transcribe,
  onSave,
  onCancel,
}: CommentComposerProps) {
  const original = mode === 'suggestion' ? (quote ?? '') : null
  // A suggestion edits the original in place, Google Docs style.
  const [body, setBody] = useState(original ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transcribed, setTranscribed] = useState<Transcribed | null>(null)
  const [transcribing, setTranscribing] = useState(false)

  const recording =
    recorder?.state.status === 'recorded' ? recorder.state.recording : null
  const transcript =
    recording && transcribed?.url === recording.url
      ? transcribed.transcript
      : null

  async function runTranscription(current: Recording) {
    if (!transcribe) return
    setTranscribing(true)
    setError(null)
    try {
      const result = await transcribe({
        audio: current.blob,
        mimeType: current.mimeType,
        durationMs: current.durationMs,
        quote,
      })
      if (!result) return
      setTranscribed({ url: current.url, transcript: result })
      // The raw text becomes the body only when the user typed nothing: for
      // a suggestion, "nothing" includes the untouched original.
      setBody((prev) =>
        prev.trim() === '' ||
        (original !== null && prev.trim() === original.trim())
          ? result.raw
          : prev,
      )
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setTranscribing(false)
    }
  }
  const busy =
    recorder?.state.status === 'recording' ||
    recorder?.state.status === 'requesting'
  const unchanged = original !== null && body.trim() === original.trim()
  // A recording with the original still untouched is a dictated suggestion
  // waiting for its transcript: saved with an empty replacement.
  const voiceOnly = unchanged && recording !== null
  const canSave =
    !saving &&
    !busy &&
    !transcribing &&
    (voiceOnly || (!unchanged && (body.trim() !== '' || recording !== null)))

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSave) return
    setSaving(true)
    setError(null)
    const draft: CommentDraft = { body: voiceOnly ? '' : body }
    if (recording) {
      draft.voice = {
        mimeType: recording.mimeType,
        durationMs: Math.round(recording.durationMs),
        recordedAt: recording.recordedAt,
      }
      if (transcript) draft.voice.transcript = transcript
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
      aria-label={mode === 'suggestion' ? 'New suggestion' : 'New comment'}
      style={{ left: placement.left, top: placement.bottom }}
      onSubmit={submit}
    >
      {quote && (
        <blockquote
          className={`comment-composer-quote${mode === 'suggestion' ? ' is-original' : ''}`}
        >
          {quote}
        </blockquote>
      )}
      {recorder && (
        <RecorderControls
          recorder={recorder}
          canTranscribe={transcribe !== null && !transcribing}
          transcribing={transcribing}
          transcript={transcript}
          onTranscribe={(current) => void runTranscription(current)}
        />
      )}
      <textarea
        aria-label={mode === 'suggestion' ? 'Replacement text' : 'Comment'}
        placeholder={placeholderFor(mode, recorder !== null)}
        rows={3}
        value={body}
        autoFocus={!recorder || mode === 'suggestion'}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          // Not while an upload runs: the result would be lost after paying.
          if (e.key === 'Escape' && !transcribing && !saving) onCancel()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.currentTarget.form?.requestSubmit()
          }
        }}
      />
      {unchanged && body.trim() !== '' && (
        <p className="comment-composer-note">
          {voiceOnly
            ? 'The replacement is still the original: the recording will be saved to transcribe later.'
            : 'Edit the text above: a suggestion must change it.'}
        </p>
      )}
      {error && (
        <p role="alert" className="comment-composer-error">
          {error}
        </p>
      )}
      <div className="comment-composer-actions">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving || transcribing}
        >
          Cancel
        </button>
        <button type="submit" className="is-primary" disabled={!canSave}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

function placeholderFor(mode: ComposerMode, hasRecorder: boolean): string {
  if (mode === 'suggestion') {
    return hasRecorder
      ? 'Type or dictate the replacement'
      : 'Edit the text as it should read'
  }
  return hasRecorder ? 'Add text (optional)' : 'What should the author know?'
}

function RecorderControls({
  recorder,
  canTranscribe,
  transcribing,
  transcript,
  onTranscribe,
}: {
  recorder: VoiceRecorder
  canTranscribe: boolean
  transcribing: boolean
  transcript: Transcript | null
  onTranscribe: (recording: Recording) => void
}) {
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
          <button
            type="button"
            onClick={recorder.discard}
            disabled={transcribing}
          >
            Re-record
          </button>
          {!transcript && (
            <button
              type="button"
              onClick={() => onTranscribe(state.recording)}
              disabled={!canTranscribe}
            >
              {transcribing ? 'Transcribing…' : 'Transcribe…'}
            </button>
          )}
          {transcript ? (
            <details className="comment-composer-raw">
              <summary>Raw transcript ({transcript.provider})</summary>
              <p>{transcript.raw}</p>
            </details>
          ) : (
            <p className="comment-composer-note">
              The recording stays on this device until you choose Transcribe and
              confirm what is sent.
            </p>
          )}
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
