/**
 * OpenAI speech-to-text behind the SpeechToTextProvider interface.
 * Endpoint and parameters per the OpenAI speech-to-text guide and API
 * reference as read on 2026-10-29: POST /v1/audio/transcriptions, multipart
 * with `file` and `model`; `gpt-transcribe` takes `languages[]` and returns
 * `{ text, languages: [{ code }] }`; the older models take `language` and
 * return `{ text }` (`verbose_json` adds `language` for whisper-1).
 */
import type { SpeechToTextProvider, TranscriptionResult } from './stt'

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
      form.append('file', request.audio, fileName(request.mimeType))
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
          `OpenAI responded ${response.status}: ${errorMessage(text)}`,
        )
      }
      let json: unknown
      try {
        json = JSON.parse(text)
      } catch {
        throw new Error(
          `OpenAI returned something that is not JSON: ${excerpt(text)}`,
        )
      }
      if (typeof json !== 'object' || json === null) {
        throw new Error(`OpenAI returned an unexpected body: ${excerpt(text)}`)
      }
      const body = json as Record<string, unknown>
      if (typeof body.text !== 'string') {
        throw new Error(`OpenAI returned no "text" field: ${excerpt(text)}`)
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

/** OpenAI picks the decoder from the filename extension. */
function fileName(mimeType: string): string {
  const type = mimeType.split(';')[0].trim().toLowerCase()
  const ext: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/mp4': 'mp4',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/flac': 'flac',
  }
  const extension = ext[type]
  if (!extension) {
    throw new Error(`OpenAI does not accept recordings of type ${mimeType}`)
  }
  return `recording.${extension}`
}

function errorMessage(body: string): string {
  try {
    const json = JSON.parse(body) as { error?: { message?: unknown } }
    if (typeof json.error?.message === 'string') {
      return redact(json.error.message)
    }
  } catch {
    // Not JSON: fall through to the raw excerpt.
  }
  return excerpt(body) || 'no response body'
}

function excerpt(text: string): string {
  return redact(text.length > 200 ? `${text.slice(0, 200)}…` : text)
}

/** OpenAI error messages can quote the key that was sent; never show it. */
function redact(text: string): string {
  return text.replace(/sk-[A-Za-z0-9_-]{4,}/g, 'sk-…')
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function joinNatural(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}
