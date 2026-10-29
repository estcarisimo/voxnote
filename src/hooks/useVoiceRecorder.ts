import { useCallback, useEffect, useRef, useState } from 'react'
import { pickRecordingMimeType } from '../core/recording'

/** A finished recording, ready to attach to a comment. */
export interface Recording {
  blob: Blob
  mimeType: string
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
 */
export function useVoiceRecorder(): VoiceRecorder {
  const [state, setState] = useState<RecorderState>({ status: 'idle' })
  const [elapsedMs, setElapsedMs] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const urlRef = useRef<string | null>(null)

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const revokeUrl = useCallback(() => {
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
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      releaseStream()
      revokeUrl()
    },
    [releaseStream, revokeUrl],
  )

  const start = useCallback(async () => {
    if (recorderRef.current) return
    setState({ status: 'requesting' })
    setElapsedMs(0)
    try {
      if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices) {
        throw new Error('This browser cannot record audio')
      }
      const mimeType = pickRecordingMimeType(MediaRecorder.isTypeSupported)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
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
        recorderRef.current = null
        releaseStream()
        setState({ status: 'error', message: 'Recording failed' })
      }
      recorder.onstop = () => {
        const durationMs = performance.now() - startedAt
        recorderRef.current = null
        releaseStream()
        const type = recorder.mimeType || mimeType
        const blob = new Blob(chunks, { type })
        if (blob.size === 0) {
          setState({
            status: 'error',
            message: 'The recording is empty. Is the microphone muted?',
          })
          return
        }
        revokeUrl()
        const url = URL.createObjectURL(blob)
        urlRef.current = url
        setState({
          status: 'recorded',
          recording: { blob, mimeType: type, durationMs, recordedAt, url },
        })
      }
      recorder.start()
      setState({ status: 'recording', startedAt })
    } catch (err: unknown) {
      recorderRef.current = null
      releaseStream()
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [releaseStream, revokeUrl])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }, [])

  const discard = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      // Drop the data: onstop would otherwise publish it.
      recorder.onstop = null
      recorder.stop()
    }
    recorderRef.current = null
    releaseStream()
    revokeUrl()
    setElapsedMs(0)
    setState({ status: 'idle' })
  }, [releaseStream, revokeUrl])

  return { state, elapsedMs, start, stop, discard }
}
