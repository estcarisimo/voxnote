import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VoiceRecorder } from '../hooks/useVoiceRecorder'
import { CommentComposer } from './CommentComposer'

const placement = { left: 10, top: 20, bottom: 40 }

function recorderWith(state: VoiceRecorder['state']): VoiceRecorder {
  return {
    state,
    elapsedMs: 0,
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    discard: vi.fn(),
  }
}

describe('CommentComposer', () => {
  it('saves a typed comment and disables Save while empty', async () => {
    const onSave = vi.fn(async () => {})
    render(
      <CommentComposer
        placement={placement}
        quote="the quoted passage"
        recorder={null}
        transcribe={null}
        onSave={onSave}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByText('the quoted passage')).toBeTruthy()
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toHaveProperty('disabled', true)

    fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), {
      target: { value: '   ' },
    })
    expect(save).toHaveProperty('disabled', true)

    fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), {
      target: { value: 'Cite the source' },
    })
    expect(save).toHaveProperty('disabled', false)
    fireEvent.click(save)
    expect(onSave).toHaveBeenCalledWith({ body: 'Cite the source' })
  })

  it('keeps the composer open and shows the error when saving fails', async () => {
    const onSave = vi.fn(async () => {
      throw new Error('IndexedDB readwrite failed: quota')
    })
    render(
      <CommentComposer
        placement={placement}
        quote={null}
        recorder={null}
        transcribe={null}
        onSave={onSave}
        onCancel={() => {}}
      />,
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), {
      target: { value: 'x' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'IndexedDB readwrite failed: quota',
    )
    expect(screen.getByRole('textbox', { name: 'Comment' })).toBeTruthy()
  })

  it('cannot save while recording, and attaches the recording when done', async () => {
    const onSave = vi.fn(async () => {})
    const recording = recorderWith({
      status: 'recording',
      startedAt: 0,
    })
    const { rerender } = render(
      <CommentComposer
        placement={placement}
        quote={null}
        recorder={recording}
        transcribe={null}
        onSave={onSave}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty(
      'disabled',
      true,
    )
    fireEvent.click(screen.getByRole('button', { name: '■ Stop' }))
    expect(recording.stop).toHaveBeenCalled()

    const blob = new Blob(['opus'], { type: 'audio/webm' })
    rerender(
      <CommentComposer
        placement={placement}
        quote={null}
        recorder={recorderWith({
          status: 'recorded',
          recording: {
            blob,
            mimeType: 'audio/webm;codecs=opus',
            durationMs: 1234.5,
            recordedAt: '2026-10-29T10:00:00.000Z',
            url: 'blob:test',
          },
        })}
        transcribe={null}
        onSave={onSave}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByText(/stays on this device/)).toBeTruthy()
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toHaveProperty('disabled', false)
    fireEvent.click(save)
    expect(onSave).toHaveBeenCalledWith({
      body: '',
      voice: {
        mimeType: 'audio/webm;codecs=opus',
        durationMs: 1235,
        recordedAt: '2026-10-29T10:00:00.000Z',
      },
      audio: blob,
    })
  })

  it('shows recorder errors and lets the user dismiss them', () => {
    const recorder = recorderWith({
      status: 'error',
      message: 'Permission denied',
    })
    render(
      <CommentComposer
        placement={placement}
        quote={null}
        recorder={recorder}
        transcribe={null}
        onSave={async () => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByRole('alert')).toHaveProperty(
      'textContent',
      'Permission denied',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(recorder.discard).toHaveBeenCalled()
  })

  it('cancels on Escape', () => {
    const onCancel = vi.fn()
    render(
      <CommentComposer
        placement={placement}
        quote={null}
        recorder={null}
        transcribe={null}
        onSave={async () => {}}
        onCancel={onCancel}
      />,
    )
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Comment' }), {
      key: 'Escape',
    })
    expect(onCancel).toHaveBeenCalled()
  })

  it('transcribes a recording on request, fills an empty body and saves the transcript', async () => {
    const onSave = vi.fn(async () => {})
    const blob = new Blob(['opus'], { type: 'audio/webm' })
    const recording = {
      blob,
      mimeType: 'audio/webm;codecs=opus',
      durationMs: 2000,
      recordedAt: '2026-10-29T10:00:00.000Z',
      url: 'blob:one',
    }
    const transcript = {
      raw: 'faltan los ejes',
      provider: 'openai/gpt-transcribe',
      language: 'es',
      transcribedAt: '2026-10-29T10:00:05.000Z',
    }
    const transcribe = vi
      .fn<(i: { quote: string | null }) => Promise<typeof transcript | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(transcript)
    render(
      <CommentComposer
        placement={placement}
        quote="the quote"
        recorder={recorderWith({ status: 'recorded', recording })}
        transcribe={transcribe}
        onSave={onSave}
        onCancel={() => {}}
      />,
    )
    // Cancelled in the consent dialog: nothing changes, no error.
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe…' }))
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1))
    expect(transcribe).toHaveBeenCalledWith({
      audio: blob,
      mimeType: 'audio/webm;codecs=opus',
      durationMs: 2000,
      quote: 'the quote',
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveProperty(
      'value',
      '',
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Transcribe…' }))
    await screen.findByText('faltan los ejes', { selector: 'p' })
    expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveProperty(
      'value',
      'faltan los ejes',
    )
    // One transcript per recording: no second upload is offered.
    expect(screen.queryByRole('button', { name: 'Transcribe…' })).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), {
      target: { value: 'Faltan los ejes en la figura 2.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith({
      body: 'Faltan los ejes en la figura 2.',
      voice: {
        mimeType: 'audio/webm;codecs=opus',
        durationMs: 2000,
        recordedAt: '2026-10-29T10:00:00.000Z',
        transcript,
      },
      audio: blob,
    })
  })

  it('ignores Escape while an upload is running', async () => {
    const onCancel = vi.fn()
    let finish!: (t: null) => void
    const transcribe = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          finish = resolve
        }),
    )
    const recording = {
      blob: new Blob(['opus']),
      mimeType: 'audio/webm',
      durationMs: 2000,
      recordedAt: '2026-10-29T10:00:00.000Z',
      url: 'blob:one',
    }
    render(
      <CommentComposer
        placement={placement}
        quote={null}
        recorder={recorderWith({ status: 'recorded', recording })}
        transcribe={transcribe}
        onSave={async () => {}}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe…' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Comment' }), {
      key: 'Escape',
    })
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty(
      'disabled',
      true,
    )
    finish(null)
    await screen.findByRole('button', { name: 'Transcribe…' })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Comment' }), {
      key: 'Escape',
    })
    expect(onCancel).toHaveBeenCalled()
  })

  it('does not overwrite typed text with the transcript and shows upload errors', async () => {
    const recording = {
      blob: new Blob(['opus']),
      mimeType: 'audio/webm',
      durationMs: 2000,
      recordedAt: '2026-10-29T10:00:00.000Z',
      url: 'blob:one',
    }
    const transcribe = vi
      .fn<
        () => Promise<{ raw: string; provider: string; transcribedAt: string }>
      >()
      .mockRejectedValueOnce(new Error('OpenAI responded 401: bad key'))
      .mockResolvedValueOnce({
        raw: 'dictated',
        provider: 'openai/gpt-transcribe',
        transcribedAt: '2026-10-29T10:00:05.000Z',
      })
    render(
      <CommentComposer
        placement={placement}
        quote={null}
        recorder={recorderWith({ status: 'recorded', recording })}
        transcribe={transcribe}
        onSave={async () => {}}
        onCancel={() => {}}
      />,
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), {
      target: { value: 'typed first' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe…' }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'OpenAI responded 401: bad key',
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Transcribe…' }))
    await screen.findByText('dictated', { selector: 'p' })
    expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveProperty(
      'value',
      'typed first',
    )
  })
})
