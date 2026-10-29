import { describe, expect, it, vi } from 'vitest'
import { createOpenAiProvider, OPENAI_ENDPOINT } from './openai'

function fetchReplying(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    void init
    return new Response(
      typeof body === 'string' ? body : JSON.stringify(body),
      { status },
    )
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

const audio = new Blob(['fake opus bytes'], { type: 'audio/webm' })
const request = {
  audio,
  mimeType: 'audio/webm;codecs=opus',
  language: 'es',
  prompt: 'quoted passage',
}

describe('OpenAI provider', () => {
  it('posts a multipart request with the key in the header and parses the result', async () => {
    const fetch = fetchReplying(200, {
      text: 'hola mundo',
      languages: [{ code: 'es' }],
    })
    const provider = createOpenAiProvider('gpt-transcribe', fetch)
    const result = await provider.transcribe(request, { apiKey: 'sk-test' })
    expect(result).toEqual({
      text: 'hola mundo',
      model: 'gpt-transcribe',
      language: 'es',
    })

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(OPENAI_ENDPOINT)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer sk-test',
    )
    const form = init.body as FormData
    expect(form.get('model')).toBe('gpt-transcribe')
    expect(form.get('response_format')).toBe('json')
    expect(form.get('languages[]')).toBe('es')
    expect(form.get('language')).toBeNull()
    expect(form.get('prompt')).toBe('quoted passage')
    const file = form.get('file') as File
    expect(file.name).toBe('recording.webm')
    expect(file.size).toBe(audio.size)
    // The key goes in the header only.
    expect(JSON.stringify(url)).not.toContain('sk-test')
  })

  it('uses the singular language field for the older models', async () => {
    const fetch = fetchReplying(200, { text: 'x' })
    const provider = createOpenAiProvider('whisper-1', fetch)
    const result = await provider.transcribe(request, { apiKey: 'k' })
    expect(result).toEqual({ text: 'x', model: 'whisper-1' })
    const form = (fetch.mock.calls[0][1] as RequestInit).body as FormData
    expect(form.get('language')).toBe('es')
    expect(form.get('languages[]')).toBeNull()
  })

  it('omits optional fields that were not given', async () => {
    const fetch = fetchReplying(200, { text: 'x', languages: [] })
    const provider = createOpenAiProvider('gpt-transcribe', fetch)
    const result = await provider.transcribe(
      { audio, mimeType: 'audio/mp4' },
      { apiKey: 'k' },
    )
    expect('language' in result).toBe(false)
    const form = (fetch.mock.calls[0][1] as RequestInit).body as FormData
    expect(form.get('languages[]')).toBeNull()
    expect(form.get('prompt')).toBeNull()
    expect((form.get('file') as File).name).toBe('recording.mp4')
  })

  it('surfaces API errors with the message OpenAI sent', async () => {
    const fetch = fetchReplying(401, {
      error: { message: 'Incorrect API key provided' },
    })
    const provider = createOpenAiProvider('gpt-transcribe', fetch)
    await expect(
      provider.transcribe(request, { apiKey: 'bad' }),
    ).rejects.toThrow(/OpenAI responded 401: Incorrect API key provided/)
  })

  it('fails loudly on a non-JSON or shapeless success body', async () => {
    const provider = createOpenAiProvider(
      'gpt-transcribe',
      fetchReplying(200, '<html>oops</html>'),
    )
    await expect(provider.transcribe(request, { apiKey: 'k' })).rejects.toThrow(
      /not JSON/,
    )
    const other = createOpenAiProvider(
      'gpt-transcribe',
      fetchReplying(200, { nope: 1 }),
    )
    await expect(other.transcribe(request, { apiKey: 'k' })).rejects.toThrow(
      /no "text" field/,
    )
  })

  it('refuses a missing key, an empty recording, an oversized one and an unknown type without calling the API', async () => {
    const fetch = fetchReplying(200, { text: 'x' })
    const provider = createOpenAiProvider('gpt-transcribe', fetch)
    await expect(
      provider.transcribe(request, { apiKey: '  ' }),
    ).rejects.toThrow(/needs an API key/)
    await expect(
      provider.transcribe(
        { audio: new Blob([]), mimeType: 'audio/webm' },
        { apiKey: 'k' },
      ),
    ).rejects.toThrow(/empty/)
    await expect(
      provider.transcribe(
        {
          audio: new Blob([new Uint8Array(26 * 1024 * 1024)]),
          mimeType: 'audio/webm',
        },
        { apiKey: 'k' },
      ),
    ).rejects.toThrow(/up to 25 MB/)
    await expect(
      provider.transcribe({ audio, mimeType: 'audio/x-aiff' }, { apiKey: 'k' }),
    ).rejects.toThrow(/does not accept/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('describes exactly what an upload sends', () => {
    const provider = createOpenAiProvider(
      'gpt-transcribe',
      fetchReplying(200, {}),
    )
    expect(provider.describeUpload(request)).toBe(
      'Sends the recording (audio/webm;codecs=opus, 15 B), the quoted passage, as a vocabulary hint and the language hint "es" to OpenAI at api.openai.com, model gpt-transcribe, with your API key. Nothing else: not the document, not other comments.',
    )
    expect(provider.describeUpload({ audio, mimeType: 'audio/mp4' })).toMatch(
      /^Sends the recording \(audio\/mp4, 15 B\) to OpenAI/,
    )
  })

  it('rejects an unknown model id up front', () => {
    expect(() => createOpenAiProvider('gpt-5-audio')).toThrow(/Unknown OpenAI/)
  })
})
