/**
 * Anthropic (Claude) text generation behind the TextModelProvider interface.
 * Per the Claude API docs as read on 2026-10-29 (platform.claude.com/docs/
 * en/api/overview, /api/versioning, /api/errors, /about-claude/models/
 * overview): POST https://api.anthropic.com/v1/messages with `x-api-key`,
 * `anthropic-version: 2026-10-21` and `content-type: application/json`;
 * body `model`, `max_tokens`, `system`, `messages`. Version 2026-10-21
 * rejects `temperature`, `top_p` and `top_k`, so none is sent. Thinking is
 * adaptive and on by default on every listed model; `output_config.effort`
 * comes from the prompt: "low" keeps a copy edit cheap. Browser requests also need
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
import type { ListedModel } from '../core/claudeModels'
import {
  assertPromptSendable,
  readJson,
  redact,
  type TextModelInfo,
  type TextModelProvider,
} from './llm'

export const ANTHROPIC_MESSAGES_ENDPOINT =
  'https://api.anthropic.com/v1/messages'
export const ANTHROPIC_MODELS_ENDPOINT = 'https://api.anthropic.com/v1/models'
export const ANTHROPIC_HOST = 'api.anthropic.com'
export const ANTHROPIC_VERSION = '2026-10-21'

/**
 * The built-in menu, used until the user asks Anthropic for the models their
 * key can use (anthropicCatalog.ts): the newest of each family on the models
 * overview, read 2026-11-23. Claude Mythos is left out: only verified
 * organizations can use it, and a key that can will list it.
 */
export const ANTHROPIC_TEXT_MODELS: readonly TextModelInfo[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (claude-opus-5-5)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (claude-sonnet-5-5)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (claude-haiku-5-5)' },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2 (claude-fable-5-2)' },
]

export const DEFAULT_ANTHROPIC_TEXT_MODEL = ANTHROPIC_TEXT_MODELS[0].id

/** Pages of 1000 are plenty; the cap only stops a server that never ends. */
const MAX_MODEL_PAGES = 10

/**
 * Every model the key can use, from GET /v1/models (`limit` up to 1000,
 * `after_id` for the next page while `has_more`). Sends the key and nothing
 * else. The endpoint answers the browser's CORS preflight for the same
 * headers as /v1/messages (checked 2026-11-23 with an OPTIONS request from
 * the site's origin).
 */
export async function listAnthropicModels(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ListedModel[]> {
  const name = 'Anthropic'
  if (apiKey.trim() === '') {
    throw new Error(`${name} needs an API key; add one under Providers`)
  }
  const models: ListedModel[] = []
  let afterId: string | undefined
  for (let page = 0; page < MAX_MODEL_PAGES; page++) {
    const url = new URL(ANTHROPIC_MODELS_ENDPOINT)
    url.searchParams.set('limit', '1000')
    if (afterId) url.searchParams.set('after_id', afterId)
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      signal,
    })
    const body = await readJson(name, response)
    if (!Array.isArray(body.data)) {
      throw new Error(`${name} returned no model list`)
    }
    for (const entry of body.data as unknown[]) {
      if (typeof entry !== 'object' || entry === null) continue
      const e = entry as Record<string, unknown>
      if (typeof e.id !== 'string') continue
      models.push({
        id: e.id,
        displayName:
          typeof e.display_name === 'string' ? e.display_name : undefined,
        createdAt: typeof e.created_at === 'string' ? e.created_at : undefined,
      })
    }
    if (body.has_more !== true) return models
    if (typeof body.last_id !== 'string' || body.last_id === afterId) {
      throw new Error(`${name} said more models follow but gave no next page`)
    }
    afterId = body.last_id
  }
  throw new Error(`${name} listed more than ${MAX_MODEL_PAGES} pages of models`)
}

/**
 * `models` is the menu the provider accepts; the registry passes the list
 * fetched for the user's key when there is one (anthropicCatalog.ts).
 */
export function createAnthropicTextProvider(
  fetchImpl: typeof fetch = fetch,
  models: readonly TextModelInfo[] = ANTHROPIC_TEXT_MODELS,
): TextModelProvider {
  const name = 'Anthropic'
  return {
    id: 'anthropic',
    name,
    endpointHost: ANTHROPIC_HOST,
    models,

    describeDestination(model) {
      return `to Anthropic at ${ANTHROPIC_HOST}, model ${model}, with your API key`
    },

    async generate(prompt, options) {
      assertPromptSendable(name, prompt, options)
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
          max_tokens: prompt.maxOutputTokens * 2,
          system: prompt.instructions,
          messages: [{ role: 'user', content: prompt.input }],
          output_config: { effort: prompt.effort },
        }),
        signal: options.signal,
      })
      return messageText(name, await readJson(name, response))
    },
  }
}

/**
 * Joins the text blocks of a Messages API answer. Thinking blocks are
 * skipped; a refusal or a cut-off answer is an error, never an answer.
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
