/**
 * Deepgram pre-recorded speech-to-text behind the SpeechToTextProvider
 * interface. Endpoint and parameters per Deepgram's docs as read on
 * 2026-10-30:
 * - API reference, https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded:
 *   POST https://api.deepgram.com/v1/listen, `Authorization: Token <key>`,
 *   query parameters `model`, `language` (default `en`), `detect_language`,
 *   `punctuate`; transcript at `results.channels[0].alternatives[0].transcript`,
 *   detected language at `results.channels[0].detected_language`.
 * - Pre-recorded guide, https://developers.deepgram.com/docs/pre-recorded-audio:
 *   a local file goes as the raw request body with a `Content-Type` matching
 *   the audio; up to 2 GB.
 * - Supported formats, https://developers.deepgram.com/docs/supported-audio-formats:
 *   MP4, AAC, M4A, Opus and WebM among them.
 * - Models and languages, https://developers.deepgram.com/docs/models-languages-overview,
 *   and language detection, https://developers.deepgram.com/docs/language-detection.
 * - Errors, https://developers.deepgram.com/docs/errors:
 *   `{ err_code, err_msg, request_id }`.
 *
 * Formatting: only `punctuate=true`, which the reference describes as adding
 * punctuation and capitalization. `smart_format` is left off on purpose: its
 * page shows it rewriting words ("thirty three grams" becomes "33 grams"),
 * and the raw transcript must stay the model's words. `numerals`,
 * `profanity_filter`, `redact`, `replace`, `summarize` and the other
 * analysis options are off for the same reason.
 *
 * Without a language hint Deepgram assumes English, so the adapter asks for
 * `detect_language=true` instead, which transcribes in the detected language.
 *
 * Streaming (not implemented here; for the live-transcription milestone):
 * the streaming reference, https://developers.deepgram.com/reference/speech-to-text/listen-streaming,
 * gives wss://api.deepgram.com/v1/listen.
 */
import type { SpeechToTextProvider, TranscriptionResult } from './stt'
import { excerpt, formatBytes, joinNatural, redact } from './stt-http'

export const DEEPGRAM_ENDPOINT = 'https://api.deepgram.com/v1/listen'
export const DEEPGRAM_HOST = 'api.deepgram.com'

export const DEEPGRAM_MODELS: readonly { id: string; label: string }[] = [
  { id: 'nova-3', label: 'nova-3 (recommended)' },
  { id: 'nova-2', label: 'nova-2' },
]

export const DEFAULT_DEEPGRAM_MODEL = DEEPGRAM_MODELS[0].id

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024

/**
 * Maps the settings' hint (ISO 639-1, or zh-cn / zh-tw / zh-hk) to the code
 * Deepgram's language table lists: "es" stays "es", "zh-tw" becomes "zh-TW".
 */
export function deepgramLanguage(hint: string): string {
  const [base, region] = hint.toLowerCase().split('-')
  return region ? `${base}-${region.toUpperCase()}` : base
}

export function createDeepgramProvider(
  modelId: string = DEFAULT_DEEPGRAM_MODEL,
  fetchImpl: typeof fetch = fetch,
): SpeechToTextProvider {
  const model = DEEPGRAM_MODELS.find((m) => m.id === modelId)
  if (!model) {
    throw new Error(`Unknown Deepgram transcription model: ${modelId}`)
  }

  return {
    id: 'deepgram',
    name: 'Deepgram',
    endpointHost: DEEPGRAM_HOST,
    // Deepgram has no free-text prompt; the quote hint is never offered.
    acceptsPrompt: false,

    describeUpload(request) {
      const parts = [
        `the recording (${request.mimeType}, ${formatBytes(request.audio.size)})`,
      ]
      if (request.language)
        parts.push(`the language hint "${deepgramLanguage(request.language)}"`)
      return (
        `Sends ${joinNatural(parts)} to Deepgram at ${DEEPGRAM_HOST}, model ${model.id}, ` +
        `with your API key. Nothing else: not the document, not other comments.`
      )
    },

    async transcribe(request, options): Promise<TranscriptionResult> {
      if (options.apiKey.trim() === '') {
        throw new Error('Deepgram needs an API key; add one under Providers')
      }
      if (request.prompt !== undefined) {
        throw new Error('Deepgram takes no prompt; the quote hint was not sent')
      }
      if (request.audio.size === 0) {
        throw new Error('Nothing to transcribe: the recording is empty')
      }
      if (request.audio.size > MAX_UPLOAD_BYTES) {
        throw new Error(
          `The recording is ${formatBytes(request.audio.size)}; Deepgram accepts up to 2 GB`,
        )
      }
      if (request.mimeType.trim() === '') {
        throw new Error('Deepgram needs the recording type; none was given')
      }

      const params = new URLSearchParams({ model: model.id, punctuate: 'true' })
      if (request.language) {
        params.set('language', deepgramLanguage(request.language))
      } else {
        params.set('detect_language', 'true')
      }

      const response = await fetchImpl(`${DEEPGRAM_ENDPOINT}?${params}`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${options.apiKey}`,
          'Content-Type': request.mimeType,
        },
        body: request.audio,
        signal: options.signal,
      })
      const text = await response.text()
      if (!response.ok) {
        throw new Error(
          `Deepgram responded ${response.status}: ${errorMessage(text, options.apiKey)}`,
        )
      }
      let json: unknown
      try {
        json = JSON.parse(text)
      } catch {
        throw new Error(
          `Deepgram returned something that is not JSON: ${excerpt(text, options.apiKey)}`,
        )
      }
      const channel = firstChannel(json)
      const transcript = channel?.alternatives?.[0]?.transcript
      if (typeof transcript !== 'string') {
        throw new Error(
          `Deepgram returned no transcript at results.channels[0].alternatives[0]: ${excerpt(text, options.apiKey)}`,
        )
      }
      if (transcript.trim() === '') {
        throw new Error('Deepgram returned an empty transcription')
      }
      const result: TranscriptionResult = { text: transcript, model: model.id }
      if (
        typeof channel?.detected_language === 'string' &&
        channel.detected_language !== ''
      ) {
        result.language = channel.detected_language
      }
      return result
    },
  }
}

interface DeepgramChannel {
  alternatives?: { transcript?: unknown }[]
  detected_language?: unknown
}

function firstChannel(json: unknown): DeepgramChannel | undefined {
  if (typeof json !== 'object' || json === null) return undefined
  const results = (json as { results?: unknown }).results
  if (typeof results !== 'object' || results === null) return undefined
  const channels = (results as { channels?: unknown }).channels
  if (!Array.isArray(channels)) return undefined
  const first: unknown = channels[0]
  if (typeof first !== 'object' || first === null) return undefined
  const alternatives = (first as { alternatives?: unknown }).alternatives
  if (!Array.isArray(alternatives)) return undefined
  const alternative: unknown = alternatives[0]
  if (typeof alternative !== 'object' || alternative === null) return undefined
  return first as DeepgramChannel
}

/** Deepgram's documented error body is `{ err_code, err_msg, request_id }`. */
function errorMessage(body: string, apiKey: string): string {
  try {
    const json = JSON.parse(body) as { err_code?: unknown; err_msg?: unknown }
    if (typeof json.err_msg === 'string') {
      const code = typeof json.err_code === 'string' ? `${json.err_code}: ` : ''
      return redact(`${code}${json.err_msg}`, apiKey)
    }
  } catch {
    // Not JSON: fall through to the raw excerpt.
  }
  return excerpt(body, apiKey) || 'no response body'
}
