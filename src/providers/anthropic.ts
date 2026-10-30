/**
 * Anthropic (Claude) text clean-up behind the TextModelProvider interface.
 * Per the Claude API docs as read on 2026-10-29 (platform.claude.com/docs/
 * en/api/overview, /api/versioning, /api/errors, /about-claude/models/
 * overview): POST https://api.anthropic.com/v1/messages with `x-api-key`,
 * `anthropic-version: 2026-10-21` and `content-type: application/json`;
 * body `model`, `max_tokens`, `system`, `messages`. Version 2026-10-21
 * rejects `temperature`, `top_p` and `top_k`, so none is sent. Thinking is
 * adaptive and on by default on every listed model; `output_config.effort:
 * "low"` keeps a copy edit cheap. Browser requests also need
 * `anthropic-dangerous-direct-browser-access: true`, the header the official
 * TypeScript SDK sends with `dangerouslyAllowBrowser` (src/client.ts in
 * anthropics/anthropic-sdk-typescript, read the same day): VoxNote is
 * bring-your-own-key, so the key is the user's and never leaves their
 * browser except to Anthropic.
 *
 * Raw fetch rather than @anthropic-ai/sdk keeps the three adapters on one
 * shape (injected fetch, one error path, one redaction) and the bundle free
 * of a second HTTP client.
 */
import {
  assertSendable,
  buildCleanUpInput,
  CLEAN_UP_INSTRUCTIONS,
  describeParts,
  joinNatural,
  outputTokenLimit,
  readJson,
  redact,
  type TextModelInfo,
  type TextModelProvider,
} from './llm'

export const ANTHROPIC_MESSAGES_ENDPOINT =
  'https://api.anthropic.com/v1/messages'
export const ANTHROPIC_HOST = 'api.anthropic.com'
export const ANTHROPIC_VERSION = '2026-10-21'

/** The current lineup on the models overview; legacy models are left out. */
export const ANTHROPIC_TEXT_MODELS: readonly TextModelInfo[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (claude-opus-5-5)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (claude-sonnet-5-5)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (claude-haiku-5-5)' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 (claude-fable-5-1)' },
]

export const DEFAULT_ANTHROPIC_TEXT_MODEL = ANTHROPIC_TEXT_MODELS[0].id

export function createAnthropicTextProvider(
  fetchImpl: typeof fetch = fetch,
): TextModelProvider {
  const name = 'Anthropic'
  return {
    id: 'anthropic',
    name,
    endpointHost: ANTHROPIC_HOST,
    models: ANTHROPIC_TEXT_MODELS,

    describeUpload(request, model) {
      return (
        `Sends ${joinNatural(describeParts(request))} to Anthropic at ${ANTHROPIC_HOST}, ` +
        `model ${model}, with your API key. Nothing else: not the recording, ` +
        `not the document, not other comments.`
      )
    },

    async cleanUp(request, options) {
      assertSendable(name, request, options)
      const response = await fetchImpl(ANTHROPIC_MESSAGES_ENDPOINT, {
        method: 'POST',
        headers: {
          'x-api-key': options.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'anthropic-dangerous-direct-browser-access': 'true',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model,
          // Thinking tokens count against max_tokens; leave room for both.
          max_tokens: outputTokenLimit(request) * 2,
          system: CLEAN_UP_INSTRUCTIONS,
          messages: [{ role: 'user', content: buildCleanUpInput(request) }],
          output_config: { effort: 'low' },
        }),
        signal: options.signal,
      })
      return messageText(name, await readJson(name, response))
    },
  }
}

/**
 * Joins the text blocks of a Messages API answer. Thinking blocks are
 * skipped; a refusal or a cut-off answer is an error, never a clean-up.
 */
function messageText(name: string, body: Record<string, unknown>): string {
  if (body.stop_reason === 'refusal') {
    const details = body.stop_details as { explanation?: unknown } | null
    const why =
      typeof details?.explanation === 'string'
        ? redact(details.explanation)
        : 'no reason given'
    throw new Error(`${name} declined: ${why}`)
  }
  if (body.stop_reason === 'max_tokens') {
    throw new Error(`${name} stopped before finishing (max_tokens)`)
  }
  if (!Array.isArray(body.content)) {
    throw new Error(`${name} returned no "content" field`)
  }
  const parts: string[] = []
  for (const block of body.content as unknown[]) {
    if (typeof block !== 'object' || block === null) continue
    const b = block as Record<string, unknown>
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
  }
  if (parts.length === 0) throw new Error(`${name} returned no text`)
  return parts.join('')
}
