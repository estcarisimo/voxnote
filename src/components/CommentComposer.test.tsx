import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VoiceRecorder } from '../hooks/useVoiceRecorder'
import type { CleanUpFn } from './CleanUpDialog'
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
        mode="comment"
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
        mode="comment"
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
        mode="comment"
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
        mode="comment"
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
        mode="comment"
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
        mode="comment"
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
        mode="comment"
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
        mode="comment"
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
        mode="comment"
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

  it('a typed suggestion starts from the original and needs a change to save', () => {
    const onSave = vi.fn(async () => {})
    render(
      <CommentComposer
        placement={placement}
        mode="suggestion"
        quote="the the results"
        recorder={null}
        transcribe={null}
        onSave={onSave}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByRole('form', { name: 'New suggestion' })).toBeTruthy()
    const field = screen.getByRole('textbox', { name: 'Replacement text' })
    expect(field).toHaveProperty('value', 'the the results')
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toHaveProperty('disabled', true)
    expect(screen.getByText(/must change it/)).toBeTruthy()

    fireEvent.change(field, { target: { value: 'the results' } })
    expect(save).toHaveProperty('disabled', false)
    fireEvent.click(save)
    expect(onSave).toHaveBeenCalledWith({ body: 'the results' })
  })

  it('a dictated suggestion takes the transcript over an untouched original', async () => {
    const recording = {
      blob: new Blob(['opus']),
      mimeType: 'audio/webm',
      durationMs: 1500,
      recordedAt: '2026-10-29T10:00:00.000Z',
      url: 'blob:one',
    }
    const transcript = {
      raw: 'the results',
      provider: 'openai/gpt-transcribe',
      transcribedAt: '2026-10-29T10:00:05.000Z',
    }
    const onSave = vi.fn(async () => {})
    render(
      <CommentComposer
        placement={placement}
        mode="suggestion"
        quote="the the results"
        recorder={recorderWith({ status: 'recorded', recording })}
        transcribe={vi.fn(async () => transcript)}
        onSave={onSave}
        onCancel={() => {}}
      />,
    )
    const field = screen.getByRole('textbox', { name: 'Replacement text' })
    expect(field).toHaveProperty('value', 'the the results')
    // Unchanged text with a recording can be saved: the replacement is
    // empty until the dictation is transcribed.
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty(
      'disabled',
      false,
    )
    expect(screen.getByText(/recording will be saved/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe…' }))
    await screen.findByText('the results', { selector: 'p' })
    expect(field).toHaveProperty('value', 'the results')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith({
      body: 'the results',
      voice: {
        mimeType: 'audio/webm',
        durationMs: 1500,
        recordedAt: '2026-10-29T10:00:00.000Z',
        transcript,
      },
      audio: recording.blob,
    })
  })

  it('saves a dictated suggestion before transcription with an empty replacement', () => {
    const recording = {
      blob: new Blob(['opus']),
      mimeType: 'audio/webm',
      durationMs: 1500,
      recordedAt: '2026-10-29T10:00:00.000Z',
      url: 'blob:one',
    }
    const onSave = vi.fn(async () => {})
    render(
      <CommentComposer
        placement={placement}
        mode="suggestion"
        quote="the the results"
        recorder={recorderWith({ status: 'recorded', recording })}
        transcribe={vi.fn()}
        onSave={onSave}
        onCancel={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith({
      body: '',
      voice: {
        mimeType: 'audio/webm',
        durationMs: 1500,
        recordedAt: '2026-10-29T10:00:00.000Z',
      },
      audio: recording.blob,
    })
  })

  it('treats text reverted to the original as untouched when a transcript arrives', async () => {
    const recording = {
      blob: new Blob(['opus']),
      mimeType: 'audio/webm',
      durationMs: 1500,
      recordedAt: '2026-10-29T10:00:00.000Z',
      url: 'blob:one',
    }
    render(
      <CommentComposer
        placement={placement}
        mode="suggestion"
        quote="the the results"
        recorder={recorderWith({ status: 'recorded', recording })}
        transcribe={vi.fn(async () => ({
          raw: 'the results',
          provider: 'p/m',
          transcribedAt: '2026-10-29T10:00:05.000Z',
        }))}
        onSave={async () => {}}
        onCancel={() => {}}
      />,
    )
    const field = screen.getByRole('textbox', { name: 'Replacement text' })
    fireEvent.change(field, { target: { value: 'something else' } })
    fireEvent.change(field, { target: { value: 'the the results' } })
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe…' }))
    await screen.findByText('the results', { selector: 'p' })
    expect(field).toHaveProperty('value', 'the results')
  })

  describe('clean-up', () => {
    const blob = new Blob(['opus'], { type: 'audio/webm' })
    const recording = {
      blob,
      mimeType: 'audio/webm',
      durationMs: 2000,
      recordedAt: '2026-10-29T10:00:00.000Z',
      url: 'blob:one',
    }
    const transcript = {
      raw: 'um faltan los los ejes',
      provider: 'openai/gpt-transcribe',
      transcribedAt: '2026-10-29T10:00:05.000Z',
    }
    const proposal = {
      text: 'Faltan los ejes.',
      cleanUp: {
        provider: 'xai',
        model: 'grok-4.7',
        createdAt: '2026-10-29T10:00:09.000Z',
        promptVersion: 1,
      },
    }

    async function transcribed(cleanUp: CleanUpFn) {
      const onSave = vi.fn(async () => {})
      render(
        <CommentComposer
          placement={placement}
          mode="comment"
          quote="the quote"
          recorder={recorderWith({ status: 'recorded', recording })}
          transcribe={vi.fn(async () => transcript)}
          cleanUp={cleanUp}
          onSave={onSave}
          onCancel={() => {}}
        />,
      )
      expect(screen.queryByRole('button', { name: 'Clean up…' })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Transcribe…' }))
      await screen.findByRole('button', { name: 'Clean up…' })
      return onSave
    }

    it('offers Clean up only with a transcript; Accept fills the body and saves the record', async () => {
      const cleanUp = vi.fn(async () => proposal)
      const onSave = await transcribed(cleanUp)
      fireEvent.click(screen.getByRole('button', { name: 'Clean up…' }))
      await vi.waitFor(() =>
        expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveProperty(
          'value',
          'Faltan los ejes.',
        ),
      )
      expect(cleanUp).toHaveBeenCalledWith({
        transcript: transcript.raw,
        kind: 'comment',
        quote: 'the quote',
        currentBody: transcript.raw,
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(onSave).toHaveBeenCalledWith({
        body: 'Faltan los ejes.',
        voice: {
          mimeType: 'audio/webm',
          durationMs: 2000,
          recordedAt: '2026-10-29T10:00:00.000Z',
          transcript,
        },
        audio: blob,
        cleanUp: proposal.cleanUp,
      })
    })

    it('flags the record when the text is edited after accepting', async () => {
      const onSave = await transcribed(vi.fn(async () => proposal))
      fireEvent.click(screen.getByRole('button', { name: 'Clean up…' }))
      await vi.waitFor(() =>
        expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveProperty(
          'value',
          'Faltan los ejes.',
        ),
      )
      fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), {
        target: { value: 'Faltan los ejes de la figura.' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          cleanUp: { ...proposal.cleanUp, editedAfter: true },
        }),
      )
    })

    it('Discard leaves the body and saves no record; errors show in place', async () => {
      const cleanUp = vi
        .fn<CleanUpFn>()
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('Anthropic responded 529: overloaded'))
      const onSave = await transcribed(cleanUp)
      fireEvent.click(screen.getByRole('button', { name: 'Clean up…' }))
      await vi.waitFor(() => expect(cleanUp).toHaveBeenCalledTimes(1))
      expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveProperty(
        'value',
        transcript.raw,
      )
      fireEvent.click(await screen.findByRole('button', { name: 'Clean up…' }))
      expect((await screen.findByRole('alert')).textContent).toBe(
        'Anthropic responded 529: overloaded',
      )
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(onSave).toHaveBeenCalledWith(
        expect.not.objectContaining({ cleanUp: expect.anything() }),
      )
    })
  })
})
