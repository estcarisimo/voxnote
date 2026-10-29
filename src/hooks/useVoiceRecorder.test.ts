// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVoiceRecorder } from './useVoiceRecorder'

/** Minimal MediaRecorder double: stop() delivers chunks then fires onstop. */
class FakeMediaRecorder {
  static isTypeSupported = (type: string) => type === 'audio/webm;codecs=opus'
  static instances: FakeMediaRecorder[] = []
  static chunkSize = 4
  state: 'inactive' | 'recording' = 'inactive'
  mimeType: string
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  stream: MediaStream
  constructor(stream: MediaStream, options: { mimeType: string }) {
    this.stream = stream
    this.mimeType = options.mimeType
    FakeMediaRecorder.instances.push(this)
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    queueMicrotask(() => {
      this.ondataavailable?.({
        data: new Blob(['x'.repeat(FakeMediaRecorder.chunkSize)]),
      })
      this.onstop?.()
    })
  }
}

function fakeStream() {
  const track = { stop: vi.fn(), onended: null as null | (() => void) }
  return {
    stream: { getTracks: () => [track] } as unknown as MediaStream,
    track,
  }
}

const flush = () => act(async () => {})

describe('useVoiceRecorder', () => {
  let getUserMedia: ReturnType<typeof vi.fn>
  let createObjectURL: ReturnType<typeof vi.fn>
  let revokeObjectURL: ReturnType<typeof vi.fn>

  beforeEach(() => {
    FakeMediaRecorder.instances = []
    FakeMediaRecorder.chunkSize = 4
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    getUserMedia = vi.fn()
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    createObjectURL = vi.fn(() => 'blob:fake')
    revokeObjectURL = vi.fn()
    URL.createObjectURL = createObjectURL as typeof URL.createObjectURL
    URL.revokeObjectURL = revokeObjectURL as typeof URL.revokeObjectURL
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('records, stops and publishes a replayable recording', async () => {
    const { stream, track } = fakeStream()
    getUserMedia.mockResolvedValue(stream)
    const { result } = renderHook(() => useVoiceRecorder())

    await act(() => result.current.start())
    expect(result.current.state.status).toBe('recording')
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })

    act(() => result.current.stop())
    await flush()
    const { state } = result.current
    expect(state.status).toBe('recorded')
    if (state.status !== 'recorded') return
    expect(state.recording.mimeType).toBe('audio/webm;codecs=opus')
    expect(state.recording.blob.size).toBe(4)
    expect(state.recording.url).toBe('blob:fake')
    expect(state.recording.recordedAt).toMatch(/Z$/)
    expect(track.stop).toHaveBeenCalledTimes(1)

    act(() => result.current.discard())
    expect(result.current.state.status).toBe('idle')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake')
  })

  it('releases the microphone when discarded while the permission prompt is up', async () => {
    const { stream, track } = fakeStream()
    let grant!: (s: MediaStream) => void
    getUserMedia.mockReturnValue(
      new Promise<MediaStream>((resolve) => {
        grant = resolve
      }),
    )
    const { result } = renderHook(() => useVoiceRecorder())
    let started!: Promise<void>
    act(() => {
      started = result.current.start()
    })
    expect(result.current.state.status).toBe('requesting')

    act(() => result.current.discard())
    expect(result.current.state.status).toBe('idle')
    await act(async () => {
      grant(stream)
      await started
    })
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(FakeMediaRecorder.instances).toHaveLength(0)
    expect(result.current.state.status).toBe('idle')

    // A fresh start after that works.
    getUserMedia.mockResolvedValue(fakeStream().stream)
    await act(() => result.current.start())
    expect(result.current.state.status).toBe('recording')
  })

  it('releases the microphone when unmounted during the prompt or while recording', async () => {
    const first = fakeStream()
    let grant!: (s: MediaStream) => void
    getUserMedia.mockReturnValueOnce(
      new Promise<MediaStream>((resolve) => {
        grant = resolve
      }),
    )
    const a = renderHook(() => useVoiceRecorder())
    let started!: Promise<void>
    act(() => {
      started = a.result.current.start()
    })
    a.unmount()
    await act(async () => {
      grant(first.stream)
      await started
    })
    expect(first.track.stop).toHaveBeenCalledTimes(1)

    const second = fakeStream()
    getUserMedia.mockResolvedValueOnce(second.stream)
    const b = renderHook(() => useVoiceRecorder())
    await act(() => b.result.current.start())
    const recorder = FakeMediaRecorder.instances[0]
    b.unmount()
    expect(recorder.state).toBe('inactive')
    expect(second.track.stop).toHaveBeenCalledTimes(1)
    await flush()
    // Handlers were detached: no URL was created for a recording nobody owns.
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('reports a denied permission and an empty recording as errors', async () => {
    getUserMedia.mockRejectedValueOnce(new Error('Permission denied'))
    const { result } = renderHook(() => useVoiceRecorder())
    await act(() => result.current.start())
    expect(result.current.state).toEqual({
      status: 'error',
      message: 'Permission denied',
    })

    act(() => result.current.discard())
    FakeMediaRecorder.chunkSize = 0
    getUserMedia.mockResolvedValueOnce(fakeStream().stream)
    await act(() => result.current.start())
    act(() => result.current.stop())
    await flush()
    expect(result.current.state).toEqual({
      status: 'error',
      message: 'The recording is empty. Is the microphone muted?',
    })
  })

  it('fails loudly when the browser cannot record', async () => {
    vi.stubGlobal('MediaRecorder', undefined)
    const { result } = renderHook(() => useVoiceRecorder())
    await act(() => result.current.start())
    expect(result.current.state).toEqual({
      status: 'error',
      message: 'This browser cannot record audio',
    })
  })

  it('stops when the microphone track ends on its own', async () => {
    const { stream, track } = fakeStream()
    getUserMedia.mockResolvedValue(stream)
    const { result } = renderHook(() => useVoiceRecorder())
    await act(() => result.current.start())
    act(() => track.onended?.())
    await flush()
    expect(result.current.state.status).toBe('recorded')
  })
})
