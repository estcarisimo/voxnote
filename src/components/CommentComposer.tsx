import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { CleanUp, Transcript, VoiceNote } from '../core/annotations'
import { cleanUpForDraft, type CleanUpProposal } from '../core/cleanUp'
import { formatDuration } from '../core/recording'
import type { AutoTranscribeState } from '../hooks/useTranscription'
import type { Recording, VoiceRecorder } from '../hooks/useVoiceRecorder'
import type { CleanUpFn } from './CleanUpDialog'
import type { ToolbarPlacement } from './SelectionToolbar'
import type { TranscribeFn } from './TranscribeDialog'
import './CommentComposer.css'

export interface CommentDraft {
  body: string
  voice?: VoiceNote
  audio?: Blob
  /** Set when the body came from an accepted clean-up of the transcript. */
  cleanUp?: CleanUp
  /**
   * Saved before the automatic transcription returned: the transcript
   * still on its way, null when cancelled, rejecting when it fails.
   */
  pendingTranscript?: Promise<Transcript | null>
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
  /** Opens the clean-up consent dialog; null when unavailable. */
  cleanUp?: CleanUpFn | null
  /** The document's standing consent to transcribe on Stop. */
  autoTranscribe?: AutoTranscribeState | null
  onSave: (draft: CommentDraft) => Promise<void>
  onCancel: () => void
}

/** A transcription request for one recording, while it runs. */
interface InFlight {
  url: string
  automatic: boolean
  promise: Promise<Transcript | null>
  controller: AbortController
  /** Saved with the comment: no longer this composer's to cancel. */
  handedOff: boolean
}

/** A transcript belongs to one recording; re-recording drops it. */
interface Transcribed {
  url: string
  transcript: Transcript
}

/** An accepted clean-up belongs to one recording's transcript, too. */
interface Cleaned {
  url: string
  proposal: CleanUpProposal
}

/**
 * Writes a comment or a suggestion for a pending anchor: typed text, a voice
 * recording, or both. A suggestion starts from the selected text so it can
 * be edited in place, Google Docs style; saving needs an actual change.
 * Saving a voice note keeps the audio on this device; transcription is a
 * separate step that needs a provider and explicit consent, given either
 * per upload in the dialog or once for the document as a standing consent,
 * in which case Stop sends the recording and Save need not wait for it.
 */
export function CommentComposer({
  placement,
  mode,
  quote,
  recorder,
  transcribe,
  cleanUp = null,
  autoTranscribe = null,
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
  const [cleaned, setCleaned] = useState<Cleaned | null>(null)
  const [cleaningUp, setCleaningUp] = useState(false)
  const [transcribingAutomatic, setTranscribingAutomatic] = useState(false)
  const inFlight = useRef<InFlight | null>(null)

  const recording =
    recorder?.state.status === 'recorded' ? recorder.state.recording : null
  const transcript =
    recording && transcribed?.url === recording.url
      ? transcribed.transcript
      : null
  const accepted =
    transcript && recording && cleaned?.url === recording.url
      ? cleaned.proposal
      : null

  async function runCleanUp(current: Recording, raw: Transcript) {
    if (!cleanUp) return
    setCleaningUp(true)
    setError(null)
    try {
      const proposal = await cleanUp({
        transcript: raw.raw,
        kind: mode,
        quote,
        currentBody: body,
      })
      if (!proposal) return
      setCleaned({ url: current.url, proposal })
      setBody(proposal.text)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCleaningUp(false)
    }
  }

  async function runTranscription(current: Recording, automatic = false) {
    if (!transcribe) return
    setTranscribing(true)
    setTranscribingAutomatic(automatic)
    setError(null)
    const controller = new AbortController()
    const promise = transcribe(
      {
        audio: current.blob,
        mimeType: current.mimeType,
        durationMs: current.durationMs,
        quote,
      },
      { automatic, signal: controller.signal },
    )
    const mine: InFlight = {
      url: current.url,
      automatic,
      promise,
      controller,
      handedOff: false,
    }
    inFlight.current = mine
    try {
      const result = await promise
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
      if (inFlight.current === mine) inFlight.current = null
      setTranscribing(false)
      setTranscribingAutomatic(false)
    }
  }

  // Stop under a standing consent sends the recording at once, through the
  // same request path as the dialog, so cancel and single-request rules hold.
  async function stopRecording() {
    if (!recorder) return
    const finished = await recorder.stop()
    if (finished && autoTranscribe?.active && transcribe) {
      void runTranscription(finished, true)
    }
  }

  // Closing the composer cancels a request it still owns.
  useEffect(
    () => () => {
      const current = inFlight.current
      if (current && !current.handedOff) current.controller.abort()
    },
    [],
  )

  function cancelTranscription() {
    inFlight.current?.controller.abort()
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
    (!transcribing || transcribingAutomatic) &&
    !cleaningUp &&
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
      const current = inFlight.current
      if (!transcript && current?.automatic && current.url === recording.url) {
        draft.pendingTranscript = current.promise
        current.handedOff = true
      }
      if (accepted && draft.body.trim() !== '') {
        draft.cleanUp = cleanUpForDraft(accepted, draft.body)
      }
    }
    try {
      await onSave(draft)
    } catch (err: unknown) {
      if (inFlight.current) inFlight.current.handedOff = false
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
          transcribingAutomatic={transcribingAutomatic}
          transcript={transcript}
          autoTranscribe={autoTranscribe}
          onTranscribe={(current) => void runTranscription(current)}
          onCancelTranscription={cancelTranscription}
          onStop={() => void stopRecording()}
          cleanUp={
            cleanUp && transcript
              ? {
                  busy: cleaningUp,
                  accepted,
                  run: (current) => void runCleanUp(current, transcript),
                }
              : null
          }
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
          if (e.key === 'Escape' && !transcribing && !cleaningUp && !saving)
            onCancel()
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
          disabled={saving || transcribing || cleaningUp}
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

function RecorderControls(
  props: Parameters<typeof RecorderState>[0] & {
    autoTranscribe: AutoTranscribeState | null
  },
) {
  const { autoTranscribe, ...rest } = props
  return (
    <>
      {autoTranscribe?.active && (
        <div className="comment-composer-auto">
          <button
            type="button"
            aria-pressed="true"
            title={autoTranscribe.consent?.disclosure}
            onClick={autoTranscribe.revoke}
          >
            Auto-transcribe: on
          </button>
          <span className="comment-composer-note">
            Stop sends each recording to {autoTranscribe.consent?.host}. Tap to
            turn off.
          </span>
        </div>
      )}
      <RecorderState {...rest} />
    </>
  )
}

function RecorderState({
  recorder,
  canTranscribe,
  transcribing,
  transcribingAutomatic,
  transcript,
  onTranscribe,
  onCancelTranscription,
  onStop,
  cleanUp,
}: {
  recorder: VoiceRecorder
  canTranscribe: boolean
  transcribing: boolean
  /** Sent on Stop: the composer shows its own Cancel instead of a dialog. */
  transcribingAutomatic: boolean
  transcript: Transcript | null
  onTranscribe: (recording: Recording) => void
  onCancelTranscription: () => void
  /** Stops recording; under a standing consent this also sends it. */
  onStop: () => void
  /** Present when a transcript exists and a clean-up can be requested. */
  cleanUp: {
    busy: boolean
    accepted: CleanUpProposal | null
    run: (recording: Recording) => void
  } | null
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
          <button type="button" onClick={onStop}>
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
            disabled={transcribing || cleanUp?.busy}
          >
            Re-record
          </button>
          {!transcript && transcribingAutomatic && (
            <>
              <span aria-live="polite">Transcribing…</span>
              <button type="button" onClick={onCancelTranscription}>
                Cancel transcription
              </button>
            </>
          )}
          {!transcript && !transcribingAutomatic && (
            <button
              type="button"
              onClick={() => onTranscribe(state.recording)}
              disabled={!canTranscribe}
            >
              {transcribing ? 'Transcribing…' : 'Transcribe…'}
            </button>
          )}
          {cleanUp && (
            <button
              type="button"
              onClick={() => cleanUp.run(state.recording)}
              disabled={cleanUp.busy}
            >
              {cleanUp.busy ? 'Cleaning up…' : 'Clean up…'}
            </button>
          )}
          {transcript ? (
            <details className="comment-composer-raw">
              <summary>Raw transcript ({transcript.provider})</summary>
              <p>{transcript.raw}</p>
              {cleanUp?.accepted && (
                <p className="comment-composer-note">
                  Text cleaned up with {cleanUp.accepted.cleanUp.provider}/
                  {cleanUp.accepted.cleanUp.model}; the raw transcript above is
                  kept.
                </p>
              )}
            </details>
          ) : transcribingAutomatic ? (
            <p className="comment-composer-note">
              You can save now: the transcript is added to the saved comment
              when it arrives.
            </p>
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
