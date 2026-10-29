import { useCallback, useEffect, useRef, useState } from 'react'
import { pickRecordingMimeType } from '../core/recording'

/** A finished recording, ready to attach to a comment. */
export interface Recording {
  blob: Blob
  mimeType: string
  /** Wall-clock time between start and stop, not the decoded media length. */
  durationMs: number
  /** UTC. */
  recordedAt: string
  /** Object URL for replay; revoked when the recording is discarded. */
  url: string
}

export type RecorderState =
  | { status: 'idle' }
  /** Waiting for microphone permission. */
  | { status: 'requesting' }
  | { status: 'recording'; startedAt: number }
  | { status: 'recorded'; recording: Recording }
  | { status: 'error'; message: string }

export interface VoiceRecorder {
  state: RecorderState
  /** Milliseconds recorded so far; updates while recording. */
  elapsedMs: number
  /** Asks for the microphone and starts recording. */
  start(): Promise<void>
  stop(): void
  /** Drops the recording or the error and returns to idle. */
  discard(): void
}

const TICK_MS = 250

/**
 * Records audio from the microphone with MediaRecorder. Everything stays in
 * memory on this device; nothing is uploaded here. Errors are surfaced in
 * `state`, never swallowed: a missing microphone or a denied permission is
 * something the user must see.
 *
 * Every start gets a generation number. A discard or unmount bumps it, so a
 * start still waiting on the permission prompt releases the microphone as
 * soon as it gets it instead of recording with no UI attached.
 */
export function useVoiceRecorder(): VoiceRecorder {
  const [state, setState] = useState<RecorderState>({ status: 'idle' })
  const [elapsedMs, setElapsedMs] = useState(0)
  const generation = useRef(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const urlRef = useRef<string | null>(null)

  /** Stops the microphone and detaches the recorder without publishing data. */
  const teardown = useCallback(() => {
    generation.current += 1
    const recorder = recorderRef.current
    if (recorder) {
      recorder.ondataavailable = null
      recorder.onstop = null
      recorder.onerror = null
      if (recorder.state !== 'inactive') recorder.stop()
    }
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = null
  }, [])

  useEffect(() => {
    if (state.status !== 'recording') return
    const timer = setInterval(() => {
      setElapsedMs(performance.now() - state.startedAt)
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [state])

  // Unmount: stop the microphone and free the replay URL.
  useEffect(() => teardown, [teardown])

  const start = useCallback(async () => {
    if (recorderRef.current || streamRef.current) return
    const mine = (generation.current += 1)
    const live = () => generation.current === mine
    setState({ status: 'requesting' })
    setElapsedMs(0)
    try {
      if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices) {
        throw new Error('This browser cannot record audio')
      }
      const mimeType = pickRecordingMimeType((type) =>
        MediaRecorder.isTypeSupported(type),
      )
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!live()) {
        // Discarded or unmounted while the permission prompt was up.
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      const recorder = new MediaRecorder(stream, { mimeType })
      recorderRef.current = recorder
      const chunks: Blob[] = []
      const startedAt = performance.now()
      const recordedAt = new Date().toISOString()

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.onerror = () => {
        teardown()
        setState({ status: 'error', message: 'Recording failed' })
      }
      recorder.onstop = () => {
        const durationMs = performance.now() - startedAt
        const type = recorder.mimeType || mimeType
        const blob = new Blob(chunks, { type })
        teardown()
        if (blob.size === 0) {
          setState({
            status: 'error',
            message: 'The recording is empty. Is the microphone muted?',
          })
          return
        }
        const url = URL.createObjectURL(blob)
        urlRef.current = url
        setState({
          status: 'recorded',
          recording: { blob, mimeType: type, durationMs, recordedAt, url },
        })
      }
      // Device unplugged or permission revoked mid-recording: finish with
      // what we have rather than sit in "recording" forever.
      for (const track of stream.getTracks()) {
        track.onended = () => recorder.state === 'recording' && recorder.stop()
      }
      recorder.start()
      setState({ status: 'recording', startedAt })
    } catch (err: unknown) {
      if (!live()) return
      teardown()
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [teardown])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }, [])

  const discard = useCallback(() => {
    teardown()
    setElapsedMs(0)
    setState((s) => (s.status === 'idle' ? s : { status: 'idle' }))
  }, [teardown])

  return { state, elapsedMs, start, stop, discard }
}
