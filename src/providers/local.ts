/**
 * A server the user runs themselves that speaks the OpenAI HTTP API:
 * whisper.cpp's `whisper-server`, faster-whisper-server (Speaches) or
 * LocalAI for speech-to-text; Ollama, LM Studio, llama.cpp's
 * `llama-server` or vLLM for polish. VoxNote knows only the base URL and
 * the model name the user typed; the API key is optional, since most local
 * servers take none.
 *
 * Requests, as the OpenAI API reference describes them (read 2026-10-29
 * for transcriptions; the chat completions shape is the one every server
 * above documents as its OpenAI-compatible route):
 * - speech-to-text: POST `<base>/audio/transcriptions`, multipart `file`,
 *   `model`, `response_format=json`, optional `language` and `prompt`;
 *   the answer is `{ text }`.
 * - polish: POST `<base>/chat/completions` with a system and a user
 *   message, `temperature: 0`, `stream: false`; the answer is
 *   `choices[0].message.content`. Chat completions rather than the
 *   Responses API because every server above implements it.
 *
 * Nothing here was run against a real local server in this repository's
 * tests: they use mocked endpoints. A browser reaches the server only when
 * the server allows this site's origin (CORS) and, from an https:// page,
 * when the address is https:// or a loopback address (localhost,
 * 127.0.0.1, [::1]); the error text says so instead of a bare "Failed to
 * fetch".
 */
import {
  assertSendable,
  buildCleanUpInput,
  CLEAN_UP_INSTRUCTIONS,
  describeParts,
  outputTokenLimit,
  readJson,
  type TextModelProvider,
} from './llm'
import type { SpeechToTextProvider, TranscriptionResult } from './stt'
import {
  excerpt,
  formatBytes,
  joinNatural,
  openAiStyleError,
  uploadFileName,
} from './stt-http'

/** What the user configures for one local server. */
export interface LocalServer {
  /** Normalized by `normalizeBaseUrl`, e.g. "http://localhost:8080/v1". */
  baseUrl: string
  /** The model name the server expects, e.g. "llama3.2:3b". */
  model: string
}

/** Examples shown as placeholders in the AI keys dialog. */
export const LOCAL_STT_EXAMPLE: LocalServer = {
  baseUrl: 'http://localhost:8080/v1',
  model: 'whisper-1',
}
export const LOCAL_TEXT_EXAMPLE: LocalServer = {
  baseUrl: 'http://localhost:11434/v1',
  model: 'llama3.2:3b',
}

/**
 * Checks and normalizes a base URL: http or https only, no user name or
 * password (a key goes in the key field, never in the address), no query
 * or fragment, no trailing slash. Throws with a reason the dialog shows.
 */
export function normalizeBaseUrl(input: string): string {
  const value = input.trim()
  if (value === '') throw new Error('Enter the server address')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(
      `"${value}" is not an address; write it like ${LOCAL_TEXT_EXAMPLE.baseUrl}`,
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The address must start with http:// or https://')
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error(
      'Put no user name or password in the address; use the key field',
    )
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error('The address must not carry a query (?…) or fragment (#…)')
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

/** Whether a stored base URL passes `normalizeBaseUrl` unchanged. */
export function isBaseUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false
  try {
    return normalizeBaseUrl(value) === value
  } catch {
    return false
  }
}

/**
 * Model names as local servers spell them: "llama3.2:3b",
 * "Systran/faster-whisper-small", "ggml-large-v3-turbo.bin". Letters,
 * digits and . _ : / @ + - only, up to 128 characters.
 */
export function isLocalModelName(value: unknown): value is string {
  return typeof value === 'string' && /^[\w.:/@+-]{1,128}$/.test(value)
}

/** host[:port] of a base URL, the "where" every disclosure names. */
export function hostOf(baseUrl: string): string {
  return new URL(baseUrl).host
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/** True for localhost, 127.0.0.1 and [::1]: this device. */
export function isLoopback(baseUrl: string): boolean {
  return LOOPBACK.has(new URL(baseUrl).hostname)
}

/**
 * Why an https:// page cannot reach this address, or null when it can (as
 * far as the address alone tells): browsers block plain http to anything
 * but a loopback address from a secure page (mixed content).
 */
export function mixedContentProblem(
  baseUrl: string,
  pageProtocol: string,
): string | null {
  if (pageProtocol !== 'https:') return null
  if (new URL(baseUrl).protocol === 'https:') return null
  if (isLoopback(baseUrl)) return null
  return (
    'This page is served over https, so the browser will block a plain ' +
    'http:// address that is not localhost. Serve the model over https ' +
    '(for example with a reverse proxy or Tailscale Serve) or run it on ' +
    'this device and use localhost.'
  )
}

/** The where-it-goes sentence both disclosures share. */
function destination(server: LocalServer): string {
  const where = isLoopback(server.baseUrl)
    ? 'on this device'
    : 'at an address you entered; VoxNote cannot tell whose machine it is'
  return `your local server ${hostOf(server.baseUrl)} (${server.baseUrl}, ${where}), model ${server.model}`
}

function keyClause(): string {
  return 'with your key if you saved one'
}

/**
 * `fetch` with an error that names the usual causes. A network failure in
 * the browser is a bare TypeError with no detail, by design (CORS and
 * mixed-content failures are not exposed to scripts).
 */
async function reach(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchImpl(url, init)
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Could not reach ${url} (${detail}). Check that the server is running, ` +
        'that it allows this site as an origin (CORS), and, from the https ' +
        'site, that the address is https:// or localhost.',
    )
  }
}

function authHeaders(apiKey: string): Record<string, string> {
  const key = apiKey.trim()
  return key === '' ? {} : { Authorization: `Bearer ${key}` }
}

/** Generous: a local server has no vendor limit, but a note is short. */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

export function createLocalSttProvider(
  server: LocalServer,
  fetchImpl: typeof fetch = fetch,
): SpeechToTextProvider {
  if (!isBaseUrl(server.baseUrl)) {
    throw new Error('Set the local speech-to-text server address in AI keys')
  }
  if (!isLocalModelName(server.model)) {
    throw new Error('Set the local speech-to-text model in AI keys')
  }
  const name = 'Local speech-to-text server'
  const endpoint = `${server.baseUrl}/audio/transcriptions`

  return {
    id: 'local-stt',
    name,
    endpointHost: hostOf(server.baseUrl),
    acceptsPrompt: true,

    describeUpload(request) {
      const parts = [
        `the recording (${request.mimeType}, ${formatBytes(request.audio.size)})`,
      ]
      if (request.prompt) parts.push('the quoted passage, as a vocabulary hint')
      if (request.language)
        parts.push(`the language hint "${request.language}"`)
      return (
        `Sends ${joinNatural(parts)} to ${destination(server)}, ${keyClause()}. ` +
        `Nothing else: not the document, not other comments.`
      )
    },

    async transcribe(request, options): Promise<TranscriptionResult> {
      if (request.audio.size === 0) {
        throw new Error('Nothing to transcribe: the recording is empty')
      }
      if (request.audio.size > MAX_UPLOAD_BYTES) {
        throw new Error(
          `The recording is ${formatBytes(request.audio.size)}; VoxNote sends up to 100 MB`,
        )
      }
      const form = new FormData()
      form.append('file', request.audio, uploadFileName(request.mimeType, name))
      form.append('model', server.model)
      form.append('response_format', 'json')
      if (request.language) form.append('language', request.language)
      if (request.prompt) form.append('prompt', request.prompt)

      const response = await reach(fetchImpl, endpoint, {
        method: 'POST',
        headers: authHeaders(options.apiKey),
        body: form,
        signal: options.signal,
      })
      const text = await response.text()
      if (!response.ok) {
        throw new Error(
          `${name} responded ${response.status}: ${openAiStyleError(text, options.apiKey)}`,
        )
      }
      let json: unknown
      try {
        json = JSON.parse(text)
      } catch {
        throw new Error(
          `${name} returned something that is not JSON: ${excerpt(text, options.apiKey)}`,
        )
      }
      if (
        typeof json !== 'object' ||
        json === null ||
        typeof (json as { text?: unknown }).text !== 'string'
      ) {
        throw new Error(
          `${name} returned no "text" field: ${excerpt(text, options.apiKey)}`,
        )
      }
      const result: TranscriptionResult = {
        text: (json as { text: string }).text,
        model: server.model,
      }
      const language = (json as { language?: unknown }).language
      if (typeof language === 'string' && language !== '') {
        result.language = language
      }
      return result
    },
  }
}

export function createLocalTextProvider(
  server: LocalServer,
  fetchImpl: typeof fetch = fetch,
): TextModelProvider {
  if (!isBaseUrl(server.baseUrl)) {
    throw new Error('Set the local text model server address in AI keys')
  }
  if (!isLocalModelName(server.model)) {
    throw new Error('Set the local text model in AI keys')
  }
  const name = 'Local text model server'
  const endpoint = `${server.baseUrl}/chat/completions`

  return {
    id: 'local-text',
    name,
    endpointHost: hostOf(server.baseUrl),
    models: [{ id: server.model, label: server.model }],

    describeUpload(request) {
      return (
        `Sends ${joinNatural(describeParts(request))} to ${destination(server)}, ` +
        `${keyClause()}. Nothing else: not the recording, not the document, not other comments.`
      )
    },

    async cleanUp(request, options) {
      // A local server usually takes no key; assertSendable wants one, so
      // it gets a stand-in and the real (possibly empty) key goes below.
      assertSendable(name, request, { ...options, apiKey: 'local' })
      const response = await reach(fetchImpl, endpoint, {
        method: 'POST',
        headers: {
          ...authHeaders(options.apiKey),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model,
          messages: [
            { role: 'system', content: CLEAN_UP_INSTRUCTIONS },
            { role: 'user', content: buildCleanUpInput(request) },
          ],
          max_tokens: outputTokenLimit(request),
          temperature: 0,
          stream: false,
        }),
        signal: options.signal,
      })
      return chatCompletionText(name, await readJson(name, response))
    },
  }
}

/**
 * The text of the first choice of a chat completions body. Throws on a
 * refusal, a cut-off answer or a missing message rather than returning a
 * partial polish.
 */
export function chatCompletionText(
  name: string,
  body: Record<string, unknown>,
): string {
  if (!Array.isArray(body.choices) || body.choices.length === 0) {
    throw new Error(`${name} returned no "choices"`)
  }
  const choice = body.choices[0] as Record<string, unknown> | null
  if (typeof choice !== 'object' || choice === null) {
    throw new Error(`${name} returned an unexpected choice`)
  }
  if (choice.finish_reason === 'length') {
    throw new Error(`${name} stopped before finishing (length)`)
  }
  const message = choice.message as Record<string, unknown> | undefined
  if (typeof message?.refusal === 'string' && message.refusal !== '') {
    throw new Error(`${name} refused: ${message.refusal}`)
  }
  if (typeof message?.content !== 'string' || message.content.trim() === '') {
    throw new Error(`${name} returned no text`)
  }
  return message.content
}
