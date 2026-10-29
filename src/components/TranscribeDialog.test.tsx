import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SpeechToTextProvider } from '../providers/stt'
import { TranscribeDialog } from './TranscribeDialog'

const provider: SpeechToTextProvider = {
  id: 'fake',
  name: 'Fake STT',
  endpointHost: 'stt.example',
  describeUpload: (r) =>
    `Sends audio${r.prompt ? ' and the quote' : ''}${r.language ? ` (${r.language})` : ''} to stt.example`,
  transcribe: vi.fn(),
}

const input = {
  audio: new Blob(['opus'], { type: 'audio/webm' }),
  mimeType: 'audio/webm',
  durationMs: 65_000,
  quote: 'the quoted passage',
}

const transcript = {
  raw: 'text',
  provider: 'fake/m',
  transcribedAt: '2026-10-29T10:00:00.000Z',
}

describe('TranscribeDialog', () => {
  it('sends nothing until confirmed, and states what will be sent', async () => {
    const onConfirm = vi.fn(async () => transcript)
    const onDone = vi.fn()
    render(
      <TranscribeDialog
        input={input}
        provider={provider}
        language="es"
        onConfirm={onConfirm}
        onDone={onDone}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByText('Sends audio (es) to stt.example')).toBeTruthy()
    expect(screen.getByText(/Recording length 1:05/)).toBeTruthy()
    expect(onConfirm).not.toHaveBeenCalled()

    // Opting into the quote changes the disclosure before anything is sent.
    fireEvent.click(screen.getByRole('checkbox'))
    expect(
      screen.getByText('Sends audio and the quote (es) to stt.example'),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Send to Fake STT' }))
    expect(onConfirm).toHaveBeenCalledWith({
      audio: input.audio,
      mimeType: 'audio/webm',
      language: 'es',
      prompt: 'the quoted passage',
    })
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith(transcript))
  })

  it('cancels without sending and keeps errors in the dialog', async () => {
    const onConfirm = vi.fn(async () => {
      throw new Error('OpenAI responded 429: rate limited')
    })
    const onCancel = vi.fn()
    const onDone = vi.fn()
    render(
      <TranscribeDialog
        input={{ ...input, quote: null }}
        provider={provider}
        language=""
        onConfirm={onConfirm}
        onDone={onDone}
        onCancel={onCancel}
      />,
    )
    expect(screen.queryByRole('checkbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Send to Fake STT' }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'OpenAI responded 429: rate limited',
    )
    expect(onDone).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm.mock.calls[0]).toEqual([
      { audio: input.audio, mimeType: 'audio/webm' },
    ])
  })
})
