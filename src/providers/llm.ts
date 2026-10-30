/**
 * Text-model adapter interface for the optional clean-up of a dictated
 * note. Providers run in the browser with the user's own key; nothing here
 * stores a key or sends anything by itself. The UI must show
 * `describeUpload` and the prompt, and get consent, before `cleanUp` runs.
 */
import { checkProposal, type CleanUpProposal } from '../core/cleanUp'

/**
 * The instruction every provider receives, verbatim, as its system or
 * developer message. Kept conservative on purpose: the reviewer's critique
 * is theirs, and a clean-up may only make it read correctly. Bump
 * CLEAN_UP_PROMPT_VERSION whenever this text changes.
 */
export const CLEAN_UP_INSTRUCTIONS = `You copy-edit a reviewer's note that was dictated and transcribed by speech-to-text.

Fix only:
- punctuation and capitalization;
- obvious speech disfluencies: filler words, false starts, accidental repetitions;
- technical terms the transcription misheard, spelled as in the quoted passage when one is given.

Keep the meaning, the language, the register and the length. Never add, soften, strengthen or remove a critique, a request, a doubt or a judgment. Do not answer, explain, summarize or expand the note, and do not address the reader.

Return only the edited note text: no quotes, no tags, no labels, no commentary.`

export const CLEAN_UP_PROMPT_VERSION = 1

/** What the caller asks to clean up. */
export interface CleanUpRequest {
  /** The raw transcript, exactly as the speech-to-text provider returned it. */
  transcript: string
  /** What the note is, so the model knows a suggestion is replacement text. */
  kind: 'comment' | 'suggestion'
  /**
   * The anchored passage, opt-in, to spell technical terms. It is sent to
   * the provider, so `describeUpload` must mention it when present.
   */
  quote?: string
  /** ISO 639-1 hint such as "es"; tells the model not to translate. */
  language?: string
}

export interface TextModelInfo {
  id: string
  label: string
  /** Deprecation date (YYYY-MM-DD) when the vendor documents one. */
  deprecated?: string
}

export interface CleanUpOptions {
  apiKey: string
  model: string
  signal?: AbortSignal
}

export interface TextModelProvider {
  /** Stable identifier, e.g. "anthropic". Part of the CleanUp record. */
  readonly id: string
  /** Shown in the UI. */
  readonly name: string
  /** Where the text goes, e.g. "api.anthropic.com". Shown before sending. */
  readonly endpointHost: string
  readonly models: readonly TextModelInfo[]
  /** Plain-language statement of exactly what this request sends. */
  describeUpload(request: CleanUpRequest, model: string): string
  /** Returns the model's text, untouched; the caller checks it. */
  cleanUp(request: CleanUpRequest, options: CleanUpOptions): Promise<string>
}

/**
 * The user message every provider receives: the note and its context,
 * wrapped in tags so the transcript is read as data, not as instructions.
 * Shown in the consent dialog exactly as it is sent.
 */
export function buildCleanUpInput(request: CleanUpRequest): string {
  const lines = [
    request.kind === 'suggestion'
      ? 'Kind: suggestion (the replacement text the reviewer proposes for the passage)'
      : 'Kind: comment (the reviewer’s remark about the passage)',
  ]
  if (request.language) {
    lines.push(`Language: ${request.language} (keep it; do not translate)`)
  }
  if (request.quote) {
    lines.push(
      'Quoted passage, only to spell terms correctly:',
      `<passage>${request.quote}</passage>`,
    )
  }
  lines.push('Dictated note:', `<note>${request.transcript}</note>`)
  return lines.join('\n')
}

/** The fields every disclosure lists, in plain words. */
export function describeParts(request: CleanUpRequest): string[] {
  const parts = [
    `the raw transcript (${request.transcript.length} characters)`,
    'the polishing instructions shown under Prompt',
  ]
  if (request.quote) parts.push('the quoted passage, as a spelling hint')
  if (request.language) parts.push(`the language hint "${request.language}"`)
  return parts
}

/**
 * Runs a provider and checks its answer before anyone sees it: an empty,
 * unchanged, or wildly longer or shorter result is an error, never a
 * proposal. Returns the proposal with a UTC timestamp.
 */
export async function cleanUp(
  provider: TextModelProvider,
  request: CleanUpRequest,
  options: CleanUpOptions,
  now: () => Date = () => new Date(),
): Promise<CleanUpProposal> {
  if (request.transcript.trim() === '') {
    throw new Error('There is no raw transcript to polish')
  }
  if (!provider.models.some((m) => m.id === options.model)) {
    throw new Error(`${provider.name} has no model "${options.model}"`)
  }
  const text = await provider.cleanUp(request, options)
  if (typeof text !== 'string') {
    throw new Error(`${provider.name} returned no text`)
  }
  return checkProposal(request.transcript, {
    text,
    cleanUp: {
      provider: provider.id,
      model: options.model,
      createdAt: now().toISOString(),
      promptVersion: CLEAN_UP_PROMPT_VERSION,
    },
  })
}

// Shared helpers for the HTTP adapters.

/** The longest note we send; longer text is not a dictated note. */
export const MAX_TRANSCRIPT_CHARS = 20_000

/**
 * Generous room for the answer: a clean-up is about as long as the input,
 * and English runs near four characters per token. Reasoning models count
 * their thinking against some of these limits, hence the floor.
 */
export function outputTokenLimit(request: CleanUpRequest): number {
  return Math.max(2048, Math.ceil(request.transcript.length / 2))
}

export function assertSendable(
  name: string,
  request: CleanUpRequest,
  options: CleanUpOptions,
): void {
  if (options.apiKey.trim() === '') {
    throw new Error(`${name} needs an API key; add one under Providers`)
  }
  if (request.transcript.trim() === '') {
    throw new Error('There is no raw transcript to polish')
  }
  if (request.transcript.length > MAX_TRANSCRIPT_CHARS) {
    throw new Error(
      `The transcript is ${request.transcript.length} characters; polishing accepts up to ${MAX_TRANSCRIPT_CHARS}`,
    )
  }
}

/** Reads a JSON response body or throws with a redacted excerpt. */
export async function readJson(
  name: string,
  response: Response,
): Promise<Record<string, unknown>> {
  const text = await response.text()
  if (!response.ok) {
    throw new Error(
      `${name} responded ${response.status}: ${errorMessage(text)}`,
    )
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(
      `${name} returned something that is not JSON: ${excerpt(text)}`,
    )
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error(`${name} returned an unexpected body: ${excerpt(text)}`)
  }
  return json as Record<string, unknown>
}

/** Both OpenAI and Anthropic put a message under `error.message`. */
function errorMessage(body: string): string {
  try {
    const json = JSON.parse(body) as { error?: unknown }
    const error = json.error
    if (typeof error === 'string') return redact(error)
    if (
      typeof error === 'object' &&
      error !== null &&
      typeof (error as { message?: unknown }).message === 'string'
    ) {
      return redact((error as { message: string }).message)
    }
  } catch {
    // Not JSON: fall through to the raw excerpt.
  }
  return excerpt(body) || 'no response body'
}

export function excerpt(text: string): string {
  return redact(text.length > 200 ? `${text.slice(0, 200)}…` : text)
}

/**
 * Error messages can quote the key that was sent; never show it. Covers
 * OpenAI (sk-…, sk-proj-…), Anthropic (sk-ant-…) and xAI (xai-…) keys.
 */
export function redact(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{4,}/g, 'sk-…')
    .replace(/xai-[A-Za-z0-9_-]{4,}/g, 'xai-…')
}

/**
 * Joins the `output_text` parts of the message items in a Responses API
 * body, the shape OpenAI and xAI share. Throws on refusals, incomplete
 * answers and missing text rather than returning a partial clean-up.
 */
export function responsesText(
  name: string,
  body: Record<string, unknown>,
): string {
  if (body.status === 'incomplete') {
    const details = body.incomplete_details as { reason?: unknown } | null
    const reason =
      typeof details?.reason === 'string' ? details.reason : 'unknown reason'
    throw new Error(`${name} stopped before finishing (${reason})`)
  }
  if (body.status !== undefined && body.status !== 'completed') {
    throw new Error(`${name} returned status "${String(body.status)}"`)
  }
  if (body.error) {
    const message = (body.error as { message?: unknown }).message
    throw new Error(
      `${name} reported an error: ${typeof message === 'string' ? redact(message) : 'unknown'}`,
    )
  }
  if (!Array.isArray(body.output)) {
    throw new Error(`${name} returned no "output" field`)
  }
  const parts: string[] = []
  for (const item of body.output as unknown[]) {
    if (typeof item !== 'object' || item === null) continue
    const i = item as Record<string, unknown>
    if (i.type !== 'message' || !Array.isArray(i.content)) continue
    for (const c of i.content as unknown[]) {
      if (typeof c !== 'object' || c === null) continue
      const part = c as Record<string, unknown>
      if (part.type === 'refusal') {
        throw new Error(
          `${name} refused: ${typeof part.refusal === 'string' ? part.refusal : 'no reason given'}`,
        )
      }
      if (part.type === 'output_text' && typeof part.text === 'string') {
        parts.push(part.text)
      }
    }
  }
  if (parts.length === 0) {
    throw new Error(`${name} returned no text`)
  }
  return parts.join('')
}

export function joinNatural(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}
