import { describe, expect, it, vi } from 'vitest'
import {
  CLEAN_UP_INSTRUCTIONS,
  cleanUpPrompt,
  describeCleanUpUpload,
} from './llm'
import {
  chatCompletionText,
  createLocalSttProvider,
  createLocalTextProvider,
  hostOf,
  isBaseUrl,
  isLocalModelName,
  mixedContentProblem,
  normalizeBaseUrl,
} from './local'

const stt = { baseUrl: 'http://localhost:8080/v1', model: 'whisper-1' }
const text = { baseUrl: 'http://localhost:11434/v1', model: 'llama3.2:3b' }
const audio = new Blob(['abc'], { type: 'audio/webm' })

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('normalizeBaseUrl', () => {
  it('keeps the origin and path and drops a trailing slash', () => {
    expect(normalizeBaseUrl(' http://localhost:8080/v1/ ')).toBe(
      'http://localhost:8080/v1',
    )
    expect(normalizeBaseUrl('https://gpu.example.ts.net/v1')).toBe(
      'https://gpu.example.ts.net/v1',
    )
    expect(normalizeBaseUrl('http://127.0.0.1:11434')).toBe(
      'http://127.0.0.1:11434',
    )
  })

  it('refuses what is not an http(s) base URL', () => {
    expect(() => normalizeBaseUrl('')).toThrow(/Enter the server address/)
    expect(() => normalizeBaseUrl('localhost:8080')).toThrow(/http/)
    expect(() => normalizeBaseUrl('ftp://host/v1')).toThrow(/http/)
    expect(() => normalizeBaseUrl('http://u:p@host/v1')).toThrow(/password/)
    expect(() => normalizeBaseUrl('http://host/v1?key=x')).toThrow(/query/)
    expect(() => normalizeBaseUrl('not a url')).toThrow(/not an address/)
  })

  it('accepts only normalized values as stored', () => {
    expect(isBaseUrl('http://localhost:8080/v1')).toBe(true)
    expect(isBaseUrl('http://localhost:8080/v1/')).toBe(false)
    expect(isBaseUrl('')).toBe(false)
    expect(isBaseUrl(42)).toBe(false)
  })
})

describe('isLocalModelName', () => {
  it('takes the names local servers use and nothing else', () => {
    for (const name of [
      'llama3.2:3b',
      'Systran/faster-whisper-small',
      'ggml-large-v3-turbo.bin',
      'qwen2.5@q4+k_m',
    ]) {
      expect(isLocalModelName(name)).toBe(true)
    }
    for (const name of ['', 'a b', 'x'.repeat(129), '<script>', 7]) {
      expect(isLocalModelName(name)).toBe(false)
    }
  })
})

describe('mixedContentProblem', () => {
  it('flags plain http to a non-loopback host from an https page only', () => {
    expect(mixedContentProblem('http://192.168.1.5:8080/v1', 'https:')).toMatch(
      /block a plain http/,
    )
    expect(mixedContentProblem('http://localhost:8080/v1', 'https:')).toBeNull()
    expect(mixedContentProblem('http://127.0.0.1:8080/v1', 'https:')).toBeNull()
    expect(mixedContentProblem('http://[::1]:8080/v1', 'https:')).toBeNull()
    expect(mixedContentProblem('https://box.lan/v1', 'https:')).toBeNull()
    expect(mixedContentProblem('http://192.168.1.5/v1', 'http:')).toBeNull()
  })
})

describe('createLocalSttProvider', () => {
  it('names the server host and says it is on this device', () => {
    const p = createLocalSttProvider(stt, vi.fn())
    expect(p.id).toBe('local-stt')
    expect(p.endpointHost).toBe('localhost:8080')
    expect(hostOf(stt.baseUrl)).toBe('localhost:8080')
    const text = p.describeUpload({
      audio,
      mimeType: 'audio/webm',
      language: 'es',
      prompt: 'quote',
    })
    expect(text).toMatch(/localhost:8080/)
    expect(text).toMatch(/on this device/)
    expect(text).toMatch(/model whisper-1/)
    expect(text).toMatch(/quoted passage/)
    expect(
      createLocalSttProvider(
        { ...stt, baseUrl: 'https://gpu.example.ts.net/v1' },
        vi.fn(),
      ).describeUpload({ audio, mimeType: 'audio/webm' }),
    ).toMatch(/cannot tell whose machine/)
  })

  it('refuses an unset server or model', () => {
    expect(() =>
      createLocalSttProvider({ baseUrl: '', model: 'm' }, vi.fn()),
    ).toThrow(/address/)
    expect(() =>
      createLocalSttProvider({ ...stt, model: 'a b' }, vi.fn()),
    ).toThrow(/model/)
  })

  it('posts multipart to <base>/audio/transcriptions, without a key when there is none', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ text: 'hola', language: 'es' }),
    )
    const p = createLocalSttProvider(stt, fetchImpl)
    const result = await p.transcribe(
      { audio, mimeType: 'audio/webm', language: 'es', prompt: 'q' },
      { apiKey: '' },
    )
    expect(result).toEqual({ text: 'hola', model: 'whisper-1', language: 'es' })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('http://localhost:8080/v1/audio/transcriptions')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({})
    const form = init.body as FormData
    expect(form.get('model')).toBe('whisper-1')
    expect(form.get('response_format')).toBe('json')
    expect(form.get('language')).toBe('es')
    expect(form.get('prompt')).toBe('q')
    expect((form.get('file') as File).name).toBe('recording.webm')
  })

  it('sends a key when one is saved', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ text: 'ok' }))
    await createLocalSttProvider(stt, fetchImpl).transcribe(
      { audio, mimeType: 'audio/webm' },
      { apiKey: 'secret' },
    )
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).toEqual({ Authorization: 'Bearer secret' })
  })

  it('fails loudly: unreachable, HTTP error, no text', async () => {
    const down = createLocalSttProvider(
      stt,
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    await expect(
      down.transcribe({ audio, mimeType: 'audio/webm' }, { apiKey: '' }),
    ).rejects.toThrow(/Could not reach .*server is running.*CORS/)

    const bad = createLocalSttProvider(
      stt,
      vi.fn(async () => jsonResponse({ error: { message: 'no model' } }, 404)),
    )
    await expect(
      bad.transcribe({ audio, mimeType: 'audio/webm' }, { apiKey: '' }),
    ).rejects.toThrow(/responded 404: no model/)

    const empty = createLocalSttProvider(
      stt,
      vi.fn(async () => jsonResponse({ result: 'x' })),
    )
    await expect(
      empty.transcribe({ audio, mimeType: 'audio/webm' }, { apiKey: '' }),
    ).rejects.toThrow(/no "text" field/)
  })
})

describe('createLocalTextProvider', () => {
  const request = {
    transcript: 'um the claim is weak',
    kind: 'comment' as const,
  }

  it('posts a chat completion with the polish instructions and reads the answer', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            message: { role: 'assistant', content: 'The claim is weak.' },
            finish_reason: 'stop',
          },
        ],
      }),
    )
    const p = createLocalTextProvider(text, fetchImpl)
    expect(p.id).toBe('local-text')
    expect(p.endpointHost).toBe('localhost:11434')
    expect(p.models).toEqual([{ id: 'llama3.2:3b', label: 'llama3.2:3b' }])
    expect(describeCleanUpUpload(p, request, text.model)).toMatch(
      /localhost:11434.*on this device.*model llama3.2:3b/,
    )
    const out = await p.generate(cleanUpPrompt(request), {
      apiKey: '',
      model: text.model,
    })
    expect(out).toBe('The claim is weak.')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('http://localhost:11434/v1/chat/completions')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.model).toBe('llama3.2:3b')
    expect(body.stream).toBe(false)
    expect(body.temperature).toBe(0)
    const messages = body.messages as { role: string; content: string }[]
    expect(messages[0]).toEqual({
      role: 'system',
      content: CLEAN_UP_INSTRUCTIONS,
    })
    expect(messages[1]?.role).toBe('user')
    expect(messages[1]?.content).toMatch(/<note>um the claim is weak<\/note>/)
  })

  it('rejects cut-off, refused or empty answers', () => {
    expect(() => chatCompletionText('L', {})).toThrow(/no "choices"/)
    expect(() =>
      chatCompletionText('L', {
        choices: [{ message: { content: 'x' }, finish_reason: 'length' }],
      }),
    ).toThrow(/stopped before finishing/)
    expect(() =>
      chatCompletionText('L', {
        choices: [{ message: { content: null, refusal: 'no' } }],
      }),
    ).toThrow(/refused: no/)
    expect(() =>
      chatCompletionText('L', { choices: [{ message: { content: ' ' } }] }),
    ).toThrow(/no text/)
  })
})
