import { describe, expect, it, vi } from 'vitest'
import {
  createDeepgramProvider,
  DEEPGRAM_ENDPOINT,
  deepgramLanguage,
} from './deepgram'

function fetchReplying(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    void init
    return new Response(
      typeof body === 'string' ? body : JSON.stringify(body),
      { status },
    )
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

function reply(transcript: string, detected?: string) {
  return {
    metadata: { request_id: 'r1' },
    results: {
      channels: [
        {
          alternatives: [{ transcript, confidence: 0.9, words: [] }],
          ...(detected ? { detected_language: detected } : {}),
        },
      ],
    },
  }
}

const KEY = 'dg0123456789abcdef'
const webm = new Blob(['fake opus bytes'], { type: 'audio/webm' })
const mp4 = new Blob(['fake aac bytes!!'], { type: 'audio/mp4' })

function call(fetch: ReturnType<typeof vi.fn>) {
  const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
  return { url: new URL(url), init }
}

describe('Deepgram provider', () => {
  it('posts the raw WebM body with its MIME type, the key only in the Token header', async () => {
    const fetch = fetchReplying(200, reply('Hola, mundo.'))
    const provider = createDeepgramProvider('nova-3', fetch)
    const result = await provider.transcribe(
      { audio: webm, mimeType: 'audio/webm;codecs=opus', language: 'es' },
      { apiKey: KEY },
    )
    expect(result).toEqual({ text: 'Hola, mundo.', model: 'nova-3' })

    const { url, init } = call(fetch)
    expect(`${url.origin}${url.pathname}`).toBe(DEEPGRAM_ENDPOINT)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      model: 'nova-3',
      punctuate: 'true',
      language: 'es',
    })
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      Authorization: `Token ${KEY}`,
      'Content-Type': 'audio/webm;codecs=opus',
    })
    expect(init.body).toBe(webm)
    expect(url.toString()).not.toContain(KEY)
  })

  it('sends MP4 (Safari) the same way, with its own type', async () => {
    const fetch = fetchReplying(200, reply('hi'))
    await createDeepgramProvider('nova-2', fetch).transcribe(
      { audio: mp4, mimeType: 'audio/mp4' },
      { apiKey: KEY },
    )
    const { url, init } = call(fetch)
    expect(url.searchParams.get('model')).toBe('nova-2')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'audio/mp4',
    )
    expect(init.body).toBe(mp4)
  })

  it('never asks for word-altering formatting', async () => {
    const fetch = fetchReplying(200, reply('x'))
    await createDeepgramProvider(undefined, fetch).transcribe(
      { audio: webm, mimeType: 'audio/webm' },
      { apiKey: KEY },
    )
    const { url } = call(fetch)
    for (const off of [
      'smart_format',
      'numerals',
      'profanity_filter',
      'redact',
      'replace',
      'summarize',
      'filler_words',
      'dictation',
      'measurements',
    ]) {
      expect(url.searchParams.has(off)).toBe(false)
    }
  })

  it('detects the language when no hint is set, and reports it', async () => {
    const fetch = fetchReplying(200, reply('bonjour', 'fr'))
    const result = await createDeepgramProvider(undefined, fetch).transcribe(
      { audio: webm, mimeType: 'audio/webm' },
      { apiKey: KEY },
    )
    expect(result).toEqual({ text: 'bonjour', model: 'nova-3', language: 'fr' })
    const { url } = call(fetch)
    expect(url.searchParams.get('detect_language')).toBe('true')
    expect(url.searchParams.has('language')).toBe(false)
  })

  it("maps the settings' hints to Deepgram's language codes", () => {
    expect(deepgramLanguage('es')).toBe('es')
    expect(deepgramLanguage('EN')).toBe('en')
    expect(deepgramLanguage('zh-cn')).toBe('zh-CN')
    expect(deepgramLanguage('zh-tw')).toBe('zh-TW')
    expect(deepgramLanguage('zh-hk')).toBe('zh-HK')
  })

  it('passes the abort signal through', async () => {
    const fetch = fetchReplying(200, reply('x'))
    const controller = new AbortController()
    await createDeepgramProvider(undefined, fetch).transcribe(
      { audio: webm, mimeType: 'audio/webm' },
      { apiKey: KEY, signal: controller.signal },
    )
    expect(call(fetch).init.signal).toBe(controller.signal)
  })

  it('surfaces errors with err_code and err_msg, never the key', async () => {
    const fetch = fetchReplying(401, {
      err_code: 'INVALID_AUTH',
      err_msg: `Invalid credentials: ${KEY}`,
      request_id: 'r1',
    })
    await expect(
      createDeepgramProvider(undefined, fetch).transcribe(
        { audio: webm, mimeType: 'audio/webm' },
        { apiKey: KEY },
      ),
    ).rejects.toThrow(
      /^Deepgram responded 401: INVALID_AUTH: Invalid credentials: \[redacted key\]$/,
    )
  })

  it('redacts the key from non-JSON error bodies too', async () => {
    const fetch = fetchReplying(502, `bad gateway for ${KEY}`)
    await expect(
      createDeepgramProvider(undefined, fetch).transcribe(
        { audio: webm, mimeType: 'audio/webm' },
        { apiKey: KEY },
      ),
    ).rejects.toThrow(
      /^Deepgram responded 502: bad gateway for \[redacted key\]$/,
    )
  })

  it('throws on an empty transcript or an unexpected shape', async () => {
    const run = (body: unknown) =>
      createDeepgramProvider(undefined, fetchReplying(200, body)).transcribe(
        { audio: webm, mimeType: 'audio/webm' },
        { apiKey: KEY },
      )
    await expect(run(reply('   '))).rejects.toThrow(/empty transcription/)
    await expect(run({ results: { channels: [] } })).rejects.toThrow(
      /no transcript/,
    )
    await expect(run({ text: 'openai shape' })).rejects.toThrow(/no transcript/)
    await expect(run('not json')).rejects.toThrow(/not JSON/)
  })

  it('refuses before sending: no key, empty audio, a prompt', async () => {
    const fetch = fetchReplying(200, reply('x'))
    const provider = createDeepgramProvider(undefined, fetch)
    await expect(
      provider.transcribe(
        { audio: webm, mimeType: 'audio/webm' },
        { apiKey: ' ' },
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
        { audio: webm, mimeType: 'audio/webm', prompt: 'quote' },
        { apiKey: KEY },
      ),
    ).rejects.toThrow(/takes no prompt/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('takes no prompt and says what it sends and where', () => {
    const provider = createDeepgramProvider('nova-3')
    expect(provider.acceptsPrompt).toBe(false)
    expect(
      provider.describeUpload({
        audio: webm,
        mimeType: 'audio/webm;codecs=opus',
        language: 'zh-tw',
      }),
    ).toBe(
      'Sends the recording (audio/webm;codecs=opus, 15 B) and the language hint "zh-TW" ' +
        'to Deepgram at api.deepgram.com, model nova-3, with your API key. ' +
        'Nothing else: not the document, not other comments.',
    )
  })

  it('rejects unknown models', () => {
    expect(() => createDeepgramProvider('nova-9')).toThrow(/Unknown Deepgram/)
  })
})
