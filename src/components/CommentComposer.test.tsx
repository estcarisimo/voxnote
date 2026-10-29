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
        onSave={async () => {}}
        onCancel={onCancel}
      />,
    )
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Comment' }), {
      key: 'Escape',
    })
    expect(onCancel).toHaveBeenCalled()
  })
})
