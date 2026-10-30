import { describe, expect, it, vi } from 'vitest'
import {
  transcribe,
  type SpeechToTextProvider,
  type TranscriptionRequest,
} from './stt'

function fakeProvider(
  impl: SpeechToTextProvider['transcribe'],
): SpeechToTextProvider {
  return {
    id: 'fake',
    name: 'Fake STT',
    endpointHost: 'stt.example',
    acceptsPrompt: true,
    describeUpload: (r) => `audio (${r.audio.size} bytes) to stt.example`,
    transcribe: impl,
  }
}

const request = (text: string): TranscriptionRequest => ({
  audio: new Blob([text], { type: 'audio/webm' }),
  mimeType: 'audio/webm',
})

describe('transcribe', () => {
  it('wraps the provider result as a UTC-stamped Transcript', async () => {
    const impl = vi.fn(async () => ({
      text: 'hola mundo',
      model: 'm1',
      language: 'es',
    }))
    const t = await transcribe(
      fakeProvider(impl),
      request('xx'),
      { apiKey: 'k' },
      () => new Date('2026-10-29T10:00:00.000Z'),
    )
    expect(t).toEqual({
      raw: 'hola mundo',
      provider: 'fake/m1',
      language: 'es',
      transcribedAt: '2026-10-29T10:00:00.000Z',
    })
    expect(impl).toHaveBeenCalledWith(expect.anything(), { apiKey: 'k' })
  })

  it('omits language when the provider did not report one', async () => {
    const t = await transcribe(
      fakeProvider(async () => ({ text: 'x', model: 'm' })),
      request('xx'),
      { apiKey: 'k' },
    )
    expect('language' in t).toBe(false)
    expect(t.transcribedAt).toMatch(/Z$/)
  })

  it('refuses empty audio without calling the provider', async () => {
    const impl = vi.fn()
    await expect(
      transcribe(fakeProvider(impl), request(''), { apiKey: 'k' }),
    ).rejects.toThrow(/recording is empty/)
    expect(impl).not.toHaveBeenCalled()
  })

  it('fails loudly on an empty transcription', async () => {
    await expect(
      transcribe(
        fakeProvider(async () => ({ text: '   ', model: 'm' })),
        request('xx'),
        { apiKey: 'k' },
      ),
    ).rejects.toThrow(/empty transcription/)
  })
})
