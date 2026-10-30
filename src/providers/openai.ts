/**
 * OpenAI speech-to-text behind the SpeechToTextProvider interface.
 * Endpoint and parameters per the OpenAI speech-to-text guide and API
 * reference as read on 2026-10-29: POST /v1/audio/transcriptions, multipart
 * with `file` and `model`; `gpt-transcribe` takes `languages[]` and returns
 * `{ text, languages: [{ code }] }`; the older models take `language` and
 * return `{ text }` (`verbose_json` adds `language` for whisper-1).
 */
import type { SpeechToTextProvider, TranscriptionResult } from './stt'
import {
  excerpt,
  formatBytes,
  joinNatural,
  openAiStyleError,
  uploadFileName,
} from './stt-http'

export const OPENAI_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions'
export const OPENAI_HOST = 'api.openai.com'

export interface OpenAiModel {
  id: string
  label: string
  /** Which multipart field carries the language hint. */
  languageField: 'languages[]' | 'language'
}

export const OPENAI_MODELS: readonly OpenAiModel[] = [
  {
    id: 'gpt-transcribe',
    label: 'gpt-transcribe (recommended)',
    languageField: 'languages[]',
  },
  {
    id: 'gpt-4o-transcribe',
    label: 'gpt-4o-transcribe (deprecated 2027-02-26)',
    languageField: 'language',
  },
  {
    id: 'gpt-4o-mini-transcribe',
    label: 'gpt-4o-mini-transcribe (deprecated 2027-02-26)',
    languageField: 'language',
  },
  {
    id: 'whisper-1',
    label: 'whisper-1 (deprecated 2027-02-26)',
    languageField: 'language',
  },
]

export const DEFAULT_OPENAI_MODEL = OPENAI_MODELS[0].id

/** 25 MB per the guide; refuse earlier with a clearer message. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

export function createOpenAiProvider(
  modelId: string = DEFAULT_OPENAI_MODEL,
  fetchImpl: typeof fetch = fetch,
): SpeechToTextProvider {
  const model = OPENAI_MODELS.find((m) => m.id === modelId)
  if (!model) throw new Error(`Unknown OpenAI transcription model: ${modelId}`)

  return {
    id: 'openai',
    name: 'OpenAI',
    endpointHost: OPENAI_HOST,
    acceptsPrompt: true,

    describeUpload(request) {
      const parts = [
        `the recording (${request.mimeType}, ${formatBytes(request.audio.size)})`,
      ]
      if (request.prompt) parts.push('the quoted passage, as a vocabulary hint')
      if (request.language)
        parts.push(`the language hint "${request.language}"`)
      return (
        `Sends ${joinNatural(parts)} to OpenAI at ${OPENAI_HOST}, model ${model.id}, ` +
        `with your API key. Nothing else: not the document, not other comments.`
      )
    },

    async transcribe(request, options): Promise<TranscriptionResult> {
      if (options.apiKey.trim() === '') {
        throw new Error('OpenAI needs an API key; add one under Providers')
      }
      if (request.audio.size === 0) {
        throw new Error('Nothing to transcribe: the recording is empty')
      }
      if (request.audio.size > MAX_UPLOAD_BYTES) {
        throw new Error(
          `The recording is ${formatBytes(request.audio.size)}; OpenAI accepts up to 25 MB`,
        )
      }
      const form = new FormData()
      form.append(
        'file',
        request.audio,
        uploadFileName(request.mimeType, 'OpenAI'),
      )
      form.append('model', model.id)
      form.append('response_format', 'json')
      if (request.language) form.append(model.languageField, request.language)
      if (request.prompt) form.append('prompt', request.prompt)

      const response = await fetchImpl(OPENAI_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.apiKey}` },
        body: form,
        signal: options.signal,
      })
      const text = await response.text()
      if (!response.ok) {
        throw new Error(
          `OpenAI responded ${response.status}: ${openAiStyleError(text, options.apiKey)}`,
        )
      }
      let json: unknown
      try {
        json = JSON.parse(text)
      } catch {
        throw new Error(
          `OpenAI returned something that is not JSON: ${excerpt(text, options.apiKey)}`,
        )
      }
      if (typeof json !== 'object' || json === null) {
        throw new Error(
          `OpenAI returned an unexpected body: ${excerpt(text, options.apiKey)}`,
        )
      }
      const body = json as Record<string, unknown>
      if (typeof body.text !== 'string') {
        throw new Error(
          `OpenAI returned no "text" field: ${excerpt(text, options.apiKey)}`,
        )
      }
      const result: TranscriptionResult = { text: body.text, model: model.id }
      const language = reportedLanguage(body)
      if (language) result.language = language
      return result
    },
  }
}

function reportedLanguage(body: Record<string, unknown>): string | undefined {
  if (Array.isArray(body.languages)) {
    const first: unknown = body.languages[0]
    if (typeof first === 'object' && first !== null) {
      const code = (first as Record<string, unknown>).code
      if (typeof code === 'string' && code !== '') return code
    }
    return undefined
  }
  return typeof body.language === 'string' && body.language !== ''
    ? body.language
    : undefined
}
