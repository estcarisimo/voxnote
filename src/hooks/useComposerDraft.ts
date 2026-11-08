import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ComposerSnapshot,
  RestoredComposer,
} from '../components/CommentComposer'
import type { Draft } from '../core/recoveryStore'
import type { DraftKeeper } from './useDraft'
import {
  useVoiceRecorder,
  type PartialRecording,
  type VoiceRecorder,
} from './useVoiceRecorder'

export interface ComposerDraft {
  /** The viewer's recorder, wired to keep its audio in the draft. */
  recorder: VoiceRecorder
  /** The restored draft for the composer, until it is saved or dropped. */
  restored: RestoredComposer | null
  /** Hand to the composer: keeps its body, transcript and polish. */
  onDraftChange: (snapshot: ComposerSnapshot) => void
  /** A composer opened on an anchor. */
  begin: DraftKeeper['begin']
  /** Saved, cancelled or discarded: the draft goes. */
  finish: () => void
}

/**
 * Connects a viewer's composer to the draft kept in IndexedDB: the recorder
 * reports its audio every second while recording and once more at Stop, a
 * discarded recording takes its transcript with it, and a draft restored at
 * open puts its recording back in the recorder. `recordingAllowed` is false
 * when no composer with a recorder is open.
 */
export function useComposerDraft(
  drafts: DraftKeeper | null,
  recordingAllowed: boolean,
): ComposerDraft {
  const update = drafts?.update
  const allowed = useRef(recordingAllowed)
  useEffect(() => {
    allowed.current = recordingAllowed
  })

  const onProgress = useCallback(
    (partial: PartialRecording) => {
      if (!allowed.current) return
      update?.({
        audio: { ...partial, complete: false },
        transcript: undefined,
        cleanUp: undefined,
      })
    },
    [update],
  )
  const recorder = useVoiceRecorder({ onProgress })

  const [restored, setRestored] = useState<RestoredComposer | null>(() =>
    drafts?.restored ? toRestored(drafts.restored) : null,
  )
  const restoredAudio = useRef(drafts?.restored?.audio ?? null)
  const { restore } = recorder
  useEffect(() => {
    const audio = restoredAudio.current
    if (!audio) return
    restoredAudio.current = null
    restore({
      blob: audio.blob,
      mimeType: audio.mimeType,
      durationMs: audio.durationMs,
      recordedAt: audio.recordedAt,
    })
  }, [restore])

  // Stop finishes the audio; Re-record or Dismiss drops it and its text.
  const status = recorder.state.status
  const finished =
    recorder.state.status === 'recorded' ? recorder.state.recording : null
  const hadAudio = useRef(false)
  useEffect(() => {
    if (!allowed.current) {
      hadAudio.current = false
      return
    }
    if (finished) {
      hadAudio.current = true
      update?.({
        audio: {
          blob: finished.blob,
          mimeType: finished.mimeType,
          durationMs: finished.durationMs,
          recordedAt: finished.recordedAt,
          complete: true,
        },
      })
    } else if (status === 'recording') {
      hadAudio.current = true
    } else if (hadAudio.current && (status === 'idle' || status === 'error')) {
      hadAudio.current = false
      update?.({ audio: undefined, transcript: undefined, cleanUp: undefined })
    }
  }, [status, finished, update])

  const onDraftChange = useCallback(
    (snapshot: ComposerSnapshot) =>
      update?.({
        body: snapshot.body,
        transcript: snapshot.transcript,
        cleanUp: snapshot.cleanUp,
      }),
    [update],
  )

  const begin = useCallback<DraftKeeper['begin']>(
    (base) => {
      setRestored(null)
      drafts?.begin(base)
    },
    [drafts],
  )

  const remove = drafts?.remove
  const finish = useCallback(() => {
    setRestored(null)
    remove?.()
  }, [remove])

  return { recorder, restored, onDraftChange, begin, finish }
}

function toRestored(draft: Draft): RestoredComposer {
  const restored: RestoredComposer = {
    body: draft.body,
    savedAt: draft.updatedAt,
  }
  if (draft.transcript) restored.transcript = draft.transcript
  if (draft.cleanUp) restored.cleanUp = draft.cleanUp
  return restored
}
