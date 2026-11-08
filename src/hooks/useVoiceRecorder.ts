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
  /**
   * Stops recording. Resolves with the finished recording, or null when
   * there is none (nothing was recording, the recording was empty or
   * failed, or it was discarded first).
   */
  stop(): Promise<Recording | null>
  /** Drops the recording or the error and returns to idle. */
  discard(): void
  /**
   * Shows a recording kept from before a crash as the finished recording,
   * with a fresh replay URL. Ignored while the microphone is in use.
   */
  restore(recording: Omit<Recording, 'url'>): void
}

/** The audio captured so far, while recording is still running. */
export type PartialRecording = Omit<Recording, 'url'>

export interface VoiceRecorderOptions {
  /**
   * Called every `CHUNK_MS` while recording with everything captured so
   * far, so a caller can keep it somewhere that survives a crash.
   */
  onProgress?: (partial: PartialRecording) => void
}

const TICK_MS = 250
/** MediaRecorder timeslice: how much audio a crash can cost at most. */
export const CHUNK_MS = 1000

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
export function useVoiceRecorder(
  options: VoiceRecorderOptions = {},
): VoiceRecorder {
  // The latest callback, without restarting a recording when it changes.
  const onProgress = useRef(options.onProgress)
  useEffect(() => {
    onProgress.current = options.onProgress
  })
  const [state, setState] = useState<RecorderState>({ status: 'idle' })
  const [elapsedMs, setElapsedMs] = useState(0)
  const generation = useRef(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const urlRef = useRef<string | null>(null)
  // Callers of stop() waiting for the recording that onstop publishes.
  const stopWaiters = useRef<((recording: Recording | null) => void)[]>([])

  const settleStop = useCallback((recording: Recording | null) => {
    const waiters = stopWaiters.current
    stopWaiters.current = []
    for (const resolve of waiters) resolve(recording)
  }, [])

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
  useEffect(
    () => () => {
      teardown()
      settleStop(null)
    },
    [teardown, settleStop],
  )

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
        if (event.data.size === 0) return
        chunks.push(event.data)
        // The final chunk arrives with Stop; onstop publishes that one.
        if (recorder.state !== 'recording') return
        const type = recorder.mimeType || mimeType
        onProgress.current?.({
          blob: new Blob(chunks, { type }),
          mimeType: type,
          durationMs: performance.now() - startedAt,
          recordedAt,
        })
      }
      recorder.onerror = () => {
        teardown()
        setState({ status: 'error', message: 'Recording failed' })
        settleStop(null)
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
          settleStop(null)
          return
        }
        const url = URL.createObjectURL(blob)
        urlRef.current = url
        const recording = { blob, mimeType: type, durationMs, recordedAt, url }
        setState({ status: 'recorded', recording })
        settleStop(recording)
      }
      // Device unplugged or permission revoked mid-recording: finish with
      // what we have rather than sit in "recording" forever.
      for (const track of stream.getTracks()) {
        track.onended = () => recorder.state === 'recording' && recorder.stop()
      }
      recorder.start(CHUNK_MS)
      setState({ status: 'recording', startedAt })
    } catch (err: unknown) {
      if (!live()) return
      teardown()
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [teardown, settleStop])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return Promise.resolve(null)
    const finished = new Promise<Recording | null>((resolve) => {
      stopWaiters.current.push(resolve)
    })
    recorder.stop()
    return finished
  }, [])

  const discard = useCallback(() => {
    teardown()
    settleStop(null)
    setElapsedMs(0)
    setState((s) => (s.status === 'idle' ? s : { status: 'idle' }))
  }, [teardown, settleStop])

  const restore = useCallback((recording: Omit<Recording, 'url'>) => {
    if (recorderRef.current || streamRef.current) return
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    const url = URL.createObjectURL(recording.blob)
    urlRef.current = url
    setElapsedMs(0)
    setState({ status: 'recorded', recording: { ...recording, url } })
  }, [])

  return { state, elapsedMs, start, stop, discard, restore }
}
