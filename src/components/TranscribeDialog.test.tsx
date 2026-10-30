import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SpeechToTextProvider } from '../providers/stt'
import { createDeepgramProvider } from '../providers/deepgram'
import { createGroqProvider } from '../providers/groq'
import { createOpenAiProvider } from '../providers/openai'
import { TranscribeDialog } from './TranscribeDialog'

const provider: SpeechToTextProvider = {
  id: 'fake',
  name: 'Fake STT',
  endpointHost: 'stt.example',
  acceptsPrompt: true,
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

  it('lets the user cancel while sending and swallows the resulting abort', async () => {
    let rejectUpload!: (err: Error) => void
    const onConfirm = vi.fn(
      () =>
        new Promise<typeof transcript>((_, reject) => {
          rejectUpload = reject
        }),
    )
    const onCancel = vi.fn()
    render(
      <TranscribeDialog
        input={{ ...input, quote: null }}
        provider={provider}
        language=""
        onConfirm={onConfirm}
        onDone={() => {}}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Send to Fake STT' }))
    const cancel = await screen.findByRole('button', { name: 'Cancel upload' })
    fireEvent.click(cancel)
    expect(onCancel).toHaveBeenCalled()
    const abort = new Error('The operation was aborted')
    abort.name = 'AbortError'
    rejectUpload(abort)
    await Promise.resolve()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('cancels on Escape', () => {
    const onCancel = vi.fn()
    render(
      <TranscribeDialog
        input={input}
        provider={provider}
        language=""
        onConfirm={vi.fn()}
        onDone={() => {}}
        onCancel={onCancel}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  it.each([
    {
      provider: createOpenAiProvider('gpt-transcribe', vi.fn()),
      host: 'api.openai.com',
      model: 'gpt-transcribe',
      quote: true,
    },
    {
      provider: createDeepgramProvider('nova-3', vi.fn()),
      host: 'api.deepgram.com',
      model: 'nova-3',
      quote: false,
    },
    {
      provider: createGroqProvider('whisper-large-v3-turbo', vi.fn()),
      host: 'api.groq.com',
      model: 'whisper-large-v3-turbo',
      quote: true,
    },
  ])(
    'names $host and $model for $provider.name, with the quote hint only if it takes a prompt',
    ({ provider: real, host, model, quote }) => {
      const onConfirm = vi.fn(async () => transcript)
      render(
        <TranscribeDialog
          input={input}
          provider={real}
          language="es"
          onConfirm={onConfirm}
          onDone={() => {}}
          onCancel={() => {}}
        />,
      )
      const disclosure = screen.getByText(/^Sends the recording/)
      expect(disclosure.textContent).toBe(
        `Sends the recording (audio/webm, 4 B) and the language hint "es" to ${real.name} at ${host}, model ${model}, ` +
          'with your API key. Nothing else: not the document, not other comments.',
      )
      expect(screen.queryByRole('checkbox') !== null).toBe(quote)
      if (quote) {
        fireEvent.click(screen.getByRole('checkbox'))
        expect(disclosure.textContent).toContain('the quoted passage')
      }
      fireEvent.click(
        screen.getByRole('button', { name: `Send to ${real.name}` }),
      )
      expect(onConfirm).toHaveBeenCalledWith({
        audio: input.audio,
        mimeType: 'audio/webm',
        language: 'es',
        ...(quote ? { prompt: 'the quoted passage' } : {}),
      })
    },
  )
})
