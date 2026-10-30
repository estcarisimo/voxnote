/**
 * Groq-hosted Whisper speech-to-text behind the SpeechToTextProvider
 * interface. Endpoint and parameters per Groq's speech-to-text guide and API
 * reference as read on 2026-10-30
 * (https://console.groq.com/docs/speech-to-text,
 * https://console.groq.com/docs/api-reference): POST
 * https://api.groq.com/openai/v1/audio/transcriptions with
 * `Authorization: Bearer <key>`, multipart `file` + `model`, optional
 * `language` (ISO-639-1), `prompt` (up to 224 tokens) and `response_format`
 * (`json` returns `{ text, x_groq: { id } }`). Accepted file types include
 * webm, mp4 and m4a; 25 MB on the free tier, 100 MB on the dev tier.
 * Errors are `{ error: { message, type } }`
 * (https://console.groq.com/docs/errors), the same shape as OpenAI's, and
 * https://console.groq.com/docs/deprecations lists no deprecation for either
 * model offered here.
 *
 * Streaming: neither page read on 2026-10-30 documents a streaming or
 * realtime transcription endpoint; the live-transcription milestone needs a
 * fresh look at Groq's docs before it can count on one.
 */
import type { SpeechToTextProvider, TranscriptionResult } from './stt'
import {
  excerpt,
  formatBytes,
  joinNatural,
  openAiStyleError,
  uploadFileName,
} from './stt-http'

export const GROQ_ENDPOINT =
  'https://api.groq.com/openai/v1/audio/transcriptions'
export const GROQ_HOST = 'api.groq.com'

export const GROQ_MODELS: readonly { id: string; label: string }[] = [
  { id: 'whisper-large-v3-turbo', label: 'whisper-large-v3-turbo' },
  { id: 'whisper-large-v3', label: 'whisper-large-v3' },
]

export const DEFAULT_GROQ_MODEL = GROQ_MODELS[0].id

/** The dev tier's limit; the free tier stops at 25 MB on Groq's side. */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

/**
 * Groq takes ISO-639-1 only, so the regional Chinese hints the settings
 * allow (zh-cn, zh-tw, zh-hk) are sent as "zh".
 */
export function groqLanguage(hint: string): string {
  return hint.toLowerCase().split('-')[0]
}

export function createGroqProvider(
  modelId: string = DEFAULT_GROQ_MODEL,
  fetchImpl: typeof fetch = fetch,
): SpeechToTextProvider {
  const model = GROQ_MODELS.find((m) => m.id === modelId)
  if (!model) throw new Error(`Unknown Groq transcription model: ${modelId}`)

  return {
    id: 'groq',
    name: 'Groq',
    endpointHost: GROQ_HOST,
    acceptsPrompt: true,

    describeUpload(request) {
      const parts = [
        `the recording (${request.mimeType}, ${formatBytes(request.audio.size)})`,
      ]
      if (request.prompt) parts.push('the quoted passage, as a vocabulary hint')
      if (request.language)
        parts.push(`the language hint "${groqLanguage(request.language)}"`)
      return (
        `Sends ${joinNatural(parts)} to Groq at ${GROQ_HOST}, model ${model.id}, ` +
        `with your API key. Nothing else: not the document, not other comments.`
      )
    },

    async transcribe(request, options): Promise<TranscriptionResult> {
      if (options.apiKey.trim() === '') {
        throw new Error('Groq needs an API key; add one under Providers')
      }
      if (request.audio.size === 0) {
        throw new Error('Nothing to transcribe: the recording is empty')
      }
      if (request.audio.size > MAX_UPLOAD_BYTES) {
        throw new Error(
          `The recording is ${formatBytes(request.audio.size)}; Groq accepts up to 100 MB (25 MB on the free tier)`,
        )
      }
      const form = new FormData()
      form.append(
        'file',
        request.audio,
        uploadFileName(request.mimeType, 'Groq'),
      )
      form.append('model', model.id)
      form.append('response_format', 'json')
      if (request.language)
        form.append('language', groqLanguage(request.language))
      if (request.prompt) form.append('prompt', request.prompt)

      const response = await fetchImpl(GROQ_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.apiKey}` },
        body: form,
        signal: options.signal,
      })
      const text = await response.text()
      if (!response.ok) {
        throw new Error(
          `Groq responded ${response.status}: ${openAiStyleError(text, options.apiKey)}`,
        )
      }
      let json: unknown
      try {
        json = JSON.parse(text)
      } catch {
        throw new Error(
          `Groq returned something that is not JSON: ${excerpt(text, options.apiKey)}`,
        )
      }
      if (typeof json !== 'object' || json === null) {
        throw new Error(
          `Groq returned an unexpected body: ${excerpt(text, options.apiKey)}`,
        )
      }
      const body = json as Record<string, unknown>
      if (typeof body.text !== 'string') {
        throw new Error(
          `Groq returned no "text" field: ${excerpt(text, options.apiKey)}`,
        )
      }
      if (body.text.trim() === '') {
        throw new Error('Groq returned an empty transcription')
      }
      return { text: body.text, model: model.id }
    },
  }
}
