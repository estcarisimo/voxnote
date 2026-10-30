import { describe, expect, it, vi } from 'vitest'
import {
  ANTHROPIC_MESSAGES_ENDPOINT,
  ANTHROPIC_VERSION,
  createAnthropicTextProvider,
} from './anthropic'
import {
  buildCleanUpInput,
  CLEAN_UP_INSTRUCTIONS,
  MAX_TRANSCRIPT_CHARS,
  type CleanUpRequest,
  type TextModelProvider,
} from './llm'
import {
  createOpenAiTextProvider,
  OPENAI_RESPONSES_ENDPOINT,
} from './openai-text'
import { createXaiTextProvider, XAI_RESPONSES_ENDPOINT } from './xai'

function fetchReplying(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    void init
    return new Response(
      typeof body === 'string' ? body : JSON.stringify(body),
      { status },
    )
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

const request: CleanUpRequest = {
  transcript: 'um the cubit claim is uh not supported',
  kind: 'comment',
  quote: 'the qubit decoheres',
  language: 'en',
}

/** A Responses API answer, the shape OpenAI and xAI share. */
function responsesBody(text: string, extra: Record<string, unknown> = {}) {
  return {
    object: 'response',
    status: 'completed',
    error: null,
    incomplete_details: null,
    output: [
      { type: 'reasoning', id: 'rs_1', summary: [] },
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text, annotations: [] }],
      },
    ],
    ...extra,
  }
}

function sent(fetch: ReturnType<typeof vi.fn>) {
  const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
  return {
    url,
    init,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(init.body as string) as Record<string, unknown>,
  }
}

const responsesProviders: [
  string,
  (f: typeof fetch) => TextModelProvider,
  string,
  string,
][] = [
  [
    'OpenAI',
    createOpenAiTextProvider,
    OPENAI_RESPONSES_ENDPOINT,
    'gpt-6.1-terra',
  ],
  ['xAI', createXaiTextProvider, XAI_RESPONSES_ENDPOINT, 'grok-4.7'],
]

describe.each(responsesProviders)(
  '%s Responses adapter',
  (name, create, endpoint, model) => {
    it('posts the prompt and the note as JSON, with the key in the header only', async () => {
      const fetch = fetchReplying(
        200,
        responsesBody('The qubit claim is not supported.'),
      )
      const text = await create(fetch).cleanUp(request, {
        apiKey: 'sk-secret-123',
        model,
      })
      expect(text).toBe('The qubit claim is not supported.')
      const { url, init, headers, body } = sent(fetch)
      expect(url).toBe(endpoint)
      expect(init.method).toBe('POST')
      expect(headers.Authorization).toBe('Bearer sk-secret-123')
      expect(headers['Content-Type']).toBe('application/json')
      expect(body.model).toBe(model)
      expect(body.instructions).toBe(CLEAN_UP_INSTRUCTIONS)
      expect(body.input).toBe(buildCleanUpInput(request))
      expect(body.store).toBe(false)
      expect(body.max_output_tokens).toBe(2048)
      expect(body).not.toHaveProperty('temperature')
      expect(init.body as string).not.toContain('sk-secret')
      expect(url).not.toContain('sk-secret')
    })

    it('throws on non-2xx with the key redacted', async () => {
      const fetch = fetchReplying(401, {
        error: { message: 'Incorrect API key provided: sk-secret-123.' },
      })
      await expect(
        create(fetch).cleanUp(request, { apiKey: 'sk-secret-123', model }),
      ).rejects.toThrow(
        `${name} responded 401: Incorrect API key provided: sk-….`,
      )
    })

    it('throws on an incomplete answer, a refusal, an error or no text', async () => {
      const cases: [unknown, RegExp][] = [
        [
          responsesBody('Partial', {
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
          }),
          /stopped before finishing \(max_output_tokens\)/,
        ],
        [
          {
            status: 'completed',
            output: [
              {
                type: 'message',
                content: [{ type: 'refusal', refusal: 'No.' }],
              },
            ],
          },
          /refused: No\./,
        ],
        [{ status: 'completed', output: [] }, /returned no text/],
        [{ status: 'completed' }, /no "output" field/],
        [{ status: 'failed', output: [] }, /status "failed"/],
        ['not json', /not JSON/],
      ]
      for (const [reply, error] of cases) {
        await expect(
          create(fetchReplying(200, reply)).cleanUp(request, {
            apiKey: 'k',
            model,
          }),
        ).rejects.toThrow(error)
      }
    })

    it('refuses to send without a key, without a transcript, or past the size limit', async () => {
      const fetch = fetchReplying(200, responsesBody('x'))
      const provider = create(fetch)
      await expect(
        provider.cleanUp(request, { apiKey: ' ', model }),
      ).rejects.toThrow(/needs an API key/)
      await expect(
        provider.cleanUp(
          { ...request, transcript: ' ' },
          { apiKey: 'k', model },
        ),
      ).rejects.toThrow(/no raw transcript/)
      await expect(
        provider.cleanUp(
          { ...request, transcript: 'x'.repeat(MAX_TRANSCRIPT_CHARS + 1) },
          { apiKey: 'k', model },
        ),
      ).rejects.toThrow(/polishing accepts up to/)
      expect(fetch).not.toHaveBeenCalled()
    })

    it('passes the abort signal to fetch', async () => {
      const fetch = fetchReplying(200, responsesBody('x'))
      const controller = new AbortController()
      await create(fetch).cleanUp(request, {
        apiKey: 'k',
        model,
        signal: controller.signal,
      })
      expect(sent(fetch).init.signal).toBe(controller.signal)
    })

    it('describes what is sent, where and to which model', () => {
      const provider = create(fetchReplying(200, {}))
      const text = provider.describeUpload(request, model)
      expect(text).toContain(provider.endpointHost)
      expect(text).toContain(`model ${model}`)
      expect(text).toContain('the raw transcript (38 characters)')
      expect(text).toContain('the quoted passage')
      expect(text).toContain('the language hint "en"')
      expect(text).toContain('store: false')
      const bare = provider.describeUpload(
        { transcript: 'abc', kind: 'comment' },
        model,
      )
      expect(bare).not.toContain('quoted passage')
      expect(bare).not.toContain('language hint')
    })
  },
)

describe('OpenAI text adapter specifics', () => {
  it('asks for low reasoning effort', async () => {
    const fetch = fetchReplying(200, responsesBody('x'))
    await createOpenAiTextProvider(fetch).cleanUp(request, {
      apiKey: 'k',
      model: 'gpt-6-luna',
    })
    expect(sent(fetch).body.reasoning).toEqual({ effort: 'low' })
  })
})

describe('xAI text adapter specifics', () => {
  it('sends no reasoning effort, whose values the docs leave per model', async () => {
    const fetch = fetchReplying(200, responsesBody('x'))
    await createXaiTextProvider(fetch).cleanUp(request, {
      apiKey: 'xai-secret-1',
      model: 'grok-4.7',
    })
    expect(sent(fetch).body).not.toHaveProperty('reasoning')
  })

  it('redacts xAI keys in error messages', async () => {
    const fetch = fetchReplying(400, {
      error: 'Incorrect API key provided: xai-secret-1',
    })
    await expect(
      createXaiTextProvider(fetch).cleanUp(request, {
        apiKey: 'xai-secret-1',
        model: 'grok-4.7',
      }),
    ).rejects.toThrow('xAI responded 400: Incorrect API key provided: xai-…')
  })
})

describe('Anthropic text adapter', () => {
  const messageBody = (text: string, extra: Record<string, unknown> = {}) => ({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text },
    ],
    stop_reason: 'end_turn',
    ...extra,
  })

  it('posts to the Messages API with the documented headers and body', async () => {
    const fetch = fetchReplying(
      200,
      messageBody('The qubit claim is not supported.'),
    )
    const text = await createAnthropicTextProvider(fetch).cleanUp(request, {
      apiKey: 'sk-ant-secret-1',
      model: 'claude-opus-5-5',
    })
    expect(text).toBe('The qubit claim is not supported.')
    const { url, headers, body, init } = sent(fetch)
    expect(url).toBe(ANTHROPIC_MESSAGES_ENDPOINT)
    expect(headers).toEqual({
      'x-api-key': 'sk-ant-secret-1',
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    })
    expect(ANTHROPIC_VERSION).toBe('2026-10-21')
    expect(body).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: 4096,
      system: CLEAN_UP_INSTRUCTIONS,
      messages: [{ role: 'user', content: buildCleanUpInput(request) }],
      output_config: { effort: 'low' },
    })
    // Version 2026-10-21 rejects sampling parameters; none is sent.
    expect(body).not.toHaveProperty('temperature')
    expect(init.body as string).not.toContain('sk-ant')
  })

  it('throws on a refusal, a cut-off answer, no text, or an error status', async () => {
    const provider = (reply: unknown, status = 200) =>
      createAnthropicTextProvider(fetchReplying(status, reply)).cleanUp(
        request,
        {
          apiKey: 'sk-ant-secret-1',
          model: 'claude-haiku-5-5',
        },
      )
    await expect(
      provider(
        messageBody('', {
          stop_reason: 'refusal',
          stop_details: {
            type: 'refusal',
            category: null,
            explanation: 'Declined.',
          },
        }),
      ),
    ).rejects.toThrow('Anthropic declined: Declined.')
    await expect(
      provider(messageBody('Partial', { stop_reason: 'max_tokens' })),
    ).rejects.toThrow(/stopped before finishing \(max_tokens\)/)
    await expect(
      provider({
        ...messageBody(''),
        content: [{ type: 'thinking', thinking: '' }],
      }),
    ).rejects.toThrow(/returned no text/)
    await expect(
      provider(
        {
          type: 'error',
          error: {
            type: 'authentication_error',
            message: 'invalid x-api-key sk-ant-secret-1',
          },
        },
        401,
      ),
    ).rejects.toThrow('Anthropic responded 401: invalid x-api-key sk-…')
  })
})

describe('buildCleanUpInput', () => {
  it('wraps the note and the optional context in tags', () => {
    expect(buildCleanUpInput(request)).toBe(
      [
        'Kind: comment (the reviewer’s remark about the passage)',
        'Language: en (keep it; do not translate)',
        'Quoted passage, only to spell terms correctly:',
        '<passage>the qubit decoheres</passage>',
        'Dictated note:',
        '<note>um the cubit claim is uh not supported</note>',
      ].join('\n'),
    )
    expect(
      buildCleanUpInput({ transcript: 'new text', kind: 'suggestion' }),
    ).toBe(
      [
        'Kind: suggestion (the replacement text the reviewer proposes for the passage)',
        'Dictated note:',
        '<note>new text</note>',
      ].join('\n'),
    )
  })
})
