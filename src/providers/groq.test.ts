import { describe, expect, it, vi } from 'vitest'
import { createGroqProvider, GROQ_ENDPOINT, groqLanguage } from './groq'

function fetchReplying(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    void init
    return new Response(
      typeof body === 'string' ? body : JSON.stringify(body),
      { status },
    )
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

const KEY = 'gsk_test0123456789'
const webm = new Blob(['fake opus bytes'], { type: 'audio/webm' })
const mp4 = new Blob(['fake aac bytes!!'], { type: 'audio/mp4' })

describe('Groq provider', () => {
  it('posts multipart file + model with Bearer auth and parses { text }', async () => {
    const fetch = fetchReplying(200, {
      text: 'hola mundo',
      x_groq: { id: 'req_1' },
    })
    const provider = createGroqProvider('whisper-large-v3-turbo', fetch)
    const result = await provider.transcribe(
      {
        audio: webm,
        mimeType: 'audio/webm;codecs=opus',
        language: 'es',
        prompt: 'quoted passage',
      },
      { apiKey: KEY },
    )
    expect(result).toEqual({
      text: 'hola mundo',
      model: 'whisper-large-v3-turbo',
    })

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(GROQ_ENDPOINT)
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ Authorization: `Bearer ${KEY}` })
    const form = init.body as FormData
    expect(form.get('model')).toBe('whisper-large-v3-turbo')
    expect(form.get('response_format')).toBe('json')
    expect(form.get('language')).toBe('es')
    expect(form.get('prompt')).toBe('quoted passage')
    const file = form.get('file') as File
    expect(file.name).toBe('recording.webm')
    expect(file.size).toBe(webm.size)
    expect(url).not.toContain(KEY)
    for (const [, value] of form.entries()) {
      if (typeof value === 'string') expect(value).not.toContain(KEY)
    }
  })

  it('sends MP4 (Safari) as recording.mp4 and omits fields not given', async () => {
    const fetch = fetchReplying(200, { text: 'x' })
    await createGroqProvider('whisper-large-v3', fetch).transcribe(
      { audio: mp4, mimeType: 'audio/mp4' },
      { apiKey: KEY },
    )
    const form = (fetch.mock.calls[0][1] as RequestInit).body as FormData
    expect((form.get('file') as File).name).toBe('recording.mp4')
    expect(form.get('model')).toBe('whisper-large-v3')
    expect(form.get('language')).toBeNull()
    expect(form.get('prompt')).toBeNull()
  })

  it('sends ISO-639-1 only', () => {
    expect(groqLanguage('es')).toBe('es')
    expect(groqLanguage('zh-tw')).toBe('zh')
  })

  it('passes the abort signal through', async () => {
    const fetch = fetchReplying(200, { text: 'x' })
    const controller = new AbortController()
    await createGroqProvider(undefined, fetch).transcribe(
      { audio: webm, mimeType: 'audio/webm' },
      { apiKey: KEY, signal: controller.signal },
    )
    expect((fetch.mock.calls[0][1] as RequestInit).signal).toBe(
      controller.signal,
    )
  })

  it('surfaces API errors with the message Groq sent, minus the key', async () => {
    const fetch = fetchReplying(401, {
      error: {
        message: `Invalid API Key ${KEY}`,
        type: 'invalid_request_error',
      },
    })
    await expect(
      createGroqProvider(undefined, fetch).transcribe(
        { audio: webm, mimeType: 'audio/webm' },
        { apiKey: KEY },
      ),
    ).rejects.toThrow(/^Groq responded 401: Invalid API Key \[redacted key\]$/)
  })

  it('throws on empty text, a missing field or a non-JSON body', async () => {
    const run = (body: unknown) =>
      createGroqProvider(undefined, fetchReplying(200, body)).transcribe(
        { audio: webm, mimeType: 'audio/webm' },
        { apiKey: KEY },
      )
    await expect(run({ text: ' ' })).rejects.toThrow(/empty transcription/)
    await expect(run({ x_groq: {} })).rejects.toThrow(/no "text" field/)
    await expect(run('<html>')).rejects.toThrow(/not JSON/)
  })

  it('refuses before sending: no key, empty audio, unknown type', async () => {
    const fetch = fetchReplying(200, { text: 'x' })
    const provider = createGroqProvider(undefined, fetch)
    await expect(
      provider.transcribe(
        { audio: webm, mimeType: 'audio/webm' },
        { apiKey: '' },
      ),
    ).rejects.toThrow(/needs an API key/)
    await expect(
      provider.transcribe(
        { audio: new Blob([]), mimeType: 'audio/webm' },
        { apiKey: KEY },
      ),
    ).rejects.toThrow(/empty/)
    await expect(
      provider.transcribe(
        { audio: webm, mimeType: 'video/quicktime' },
        { apiKey: KEY },
      ),
    ).rejects.toThrow(/Groq does not accept/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('takes a prompt and says what it sends and where', () => {
    const provider = createGroqProvider()
    expect(provider.acceptsPrompt).toBe(true)
    expect(
      provider.describeUpload({
        audio: mp4,
        mimeType: 'audio/mp4',
        language: 'es',
        prompt: 'q',
      }),
    ).toBe(
      'Sends the recording (audio/mp4, 16 B), the quoted passage, as a vocabulary hint ' +
        'and the language hint "es" to Groq at api.groq.com, model whisper-large-v3-turbo, ' +
        'with your API key. Nothing else: not the document, not other comments.',
    )
  })

  it('rejects unknown models', () => {
    expect(() => createGroqProvider('distil-whisper-large-v3-en')).toThrow(
      /Unknown Groq/,
    )
  })
})
