/**
 * Speech-to-text adapter interface. Providers run in the browser with the
 * user's own key; nothing here stores a key or sends anything by itself.
 * The UI must show `describeUpload` and get consent before calling
 * `transcribe`, every time audio leaves the device.
 */
import type { Transcript } from '../core/annotations'

export interface TranscriptionRequest {
  audio: Blob
  /** MIME type of `audio`, e.g. "audio/webm;codecs=opus" or "audio/mp4". */
  mimeType: string
  /** BCP 47 hint; providers that cannot use it ignore it. */
  language?: string
  /**
   * Short context to bias vocabulary, typically the quoted passage. It is
   * sent to the provider, so `describeUpload` must mention it when present.
   */
  prompt?: string
}

export interface TranscriptionResult {
  text: string
  /** The model actually used, for the Transcript record. */
  model: string
  language?: string
}

export interface SpeechToTextProvider {
  /** Stable identifier, e.g. "openai". Part of Transcript.provider. */
  readonly id: string
  /** Shown in the UI. */
  readonly name: string
  /** Where the audio goes, e.g. "api.openai.com". Shown before sending. */
  readonly endpointHost: string
  /**
   * Whether the provider takes a text prompt (`TranscriptionRequest.prompt`).
   * When false the UI must not offer the quote hint, and `transcribe`
   * refuses a request that carries one.
   */
  readonly acceptsPrompt: boolean
  /** Plain-language statement of exactly what this request sends. */
  describeUpload(request: TranscriptionRequest): string
  transcribe(
    request: TranscriptionRequest,
    options: { apiKey: string; signal?: AbortSignal },
  ): Promise<TranscriptionResult>
}

/**
 * Runs a provider and wraps its answer as a Transcript record with a UTC
 * timestamp. An empty transcription is an error: silence or a dropped upload
 * must not become an empty comment that looks intentional.
 */
export async function transcribe(
  provider: SpeechToTextProvider,
  request: TranscriptionRequest,
  options: { apiKey: string; signal?: AbortSignal },
  now: () => Date = () => new Date(),
): Promise<Transcript> {
  if (request.audio.size === 0) {
    throw new Error('Nothing to transcribe: the recording is empty')
  }
  if (request.prompt !== undefined && !provider.acceptsPrompt) {
    throw new Error(
      `${provider.name} takes no prompt; the quote hint was not sent`,
    )
  }
  const result = await provider.transcribe(request, options)
  if (typeof result.text !== 'string' || result.text.trim() === '') {
    throw new Error(`${provider.name} returned an empty transcription`)
  }
  const transcript: Transcript = {
    raw: result.text,
    provider: `${provider.id}/${result.model}`,
    transcribedAt: now().toISOString(),
  }
  if (result.language) transcript.language = result.language
  return transcript
}
