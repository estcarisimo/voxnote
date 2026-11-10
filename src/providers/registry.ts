/**
 * The providers VoxNote knows about and the local, non-secret settings that
 * pick one. Speech-to-text and text clean-up are chosen separately; a
 * provider that offers both (OpenAI) has one key for both. Every other
 * provider has its own key id, so a key is only ever sent to the host of
 * the provider it was saved for. The two local providers ("local-stt",
 * "local-text") are servers the user runs, reached at a base URL kept in
 * the settings with the model name; their key is optional. The API key itself
 * lives in the encrypted secret store under `SECRET_NAMES[id]`; nothing here
 * reads or writes it.
 */
import {
  ANTHROPIC_TEXT_MODELS,
  createAnthropicTextProvider,
  DEFAULT_ANTHROPIC_TEXT_MODEL,
} from './anthropic'
import {
  createDeepgramProvider,
  DEEPGRAM_MODELS,
  DEFAULT_DEEPGRAM_MODEL,
} from './deepgram'
import { createGroqProvider, DEFAULT_GROQ_MODEL, GROQ_MODELS } from './groq'
import type { TextModelInfo, TextModelProvider } from './llm'
import {
  createOpenAiProvider,
  DEFAULT_OPENAI_MODEL,
  OPENAI_MODELS,
} from './openai'
import {
  createOpenAiTextProvider,
  DEFAULT_OPENAI_TEXT_MODEL,
  OPENAI_TEXT_MODELS,
} from './openai-text'
import {
  createLocalSttProvider,
  createLocalTextProvider,
  isBaseUrl,
  isLocalModelName,
  type LocalServer,
} from './local'
import type { SpeechToTextProvider } from './stt'
import {
  createXaiTextProvider,
  DEFAULT_XAI_TEXT_MODEL,
  XAI_TEXT_MODELS,
} from './xai'

/** Every provider that may hold a key. */
export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'xai'
  | 'deepgram'
  | 'groq'
  | 'local-stt'
  | 'local-text'
export type SttProviderId = 'openai' | 'deepgram' | 'groq' | 'local-stt'
export type TextProviderId = 'openai' | 'anthropic' | 'xai' | 'local-text'
/** The providers the user runs: a base URL and a model, key optional. */
export type LocalProviderId = 'local-stt' | 'local-text'

export const PROVIDER_IDS: readonly ProviderId[] = [
  'openai',
  'anthropic',
  'xai',
  'deepgram',
  'groq',
  'local-stt',
  'local-text',
]
export const STT_PROVIDER_IDS: readonly SttProviderId[] = [
  'openai',
  'deepgram',
  'groq',
  'local-stt',
]
export const TEXT_PROVIDER_IDS: readonly TextProviderId[] = [
  'openai',
  'anthropic',
  'xai',
  'local-text',
]

export function isLocalProviderId(value: unknown): value is LocalProviderId {
  return value === 'local-stt' || value === 'local-text'
}

/** One key per provider id, shared by every capability that provider has. */
export const SECRET_NAMES: Record<ProviderId, string> = {
  openai: 'openai.apiKey',
  anthropic: 'anthropic.apiKey',
  xai: 'xai.apiKey',
  deepgram: 'deepgram.apiKey',
  groq: 'groq.apiKey',
  'local-stt': 'local-stt.apiKey',
  'local-text': 'local-text.apiKey',
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  xai: 'xAI (Grok)',
  deepgram: 'Deepgram',
  groq: 'Groq (hosted Whisper)',
  'local-stt': 'Local speech-to-text server',
  'local-text': 'Local text model server',
}

export const STT_MODELS: Record<
  SttProviderId,
  readonly { id: string; label: string }[]
> = {
  openai: OPENAI_MODELS,
  deepgram: DEEPGRAM_MODELS,
  groq: GROQ_MODELS,
  // A local server's model is whatever the user typed (settings.local).
  'local-stt': [],
}

export const DEFAULT_STT_MODELS: Record<SttProviderId, string> = {
  openai: DEFAULT_OPENAI_MODEL,
  deepgram: DEFAULT_DEEPGRAM_MODEL,
  groq: DEFAULT_GROQ_MODEL,
  'local-stt': '',
}

export const TEXT_MODELS: Record<TextProviderId, readonly TextModelInfo[]> = {
  openai: OPENAI_TEXT_MODELS,
  anthropic: ANTHROPIC_TEXT_MODELS,
  xai: XAI_TEXT_MODELS,
  'local-text': [],
}

export const DEFAULT_TEXT_MODELS: Record<TextProviderId, string> = {
  openai: DEFAULT_OPENAI_TEXT_MODEL,
  anthropic: DEFAULT_ANTHROPIC_TEXT_MODEL,
  xai: DEFAULT_XAI_TEXT_MODEL,
  'local-text': '',
}

/** Non-secret transcription settings, kept in localStorage. */
export interface SttSettings {
  provider: SttProviderId
  model: string
  /** ISO 639-1 hint such as "es", or empty for auto-detect. */
  language: string
  /**
   * The local speech-to-text server, once configured. Kept when another
   * provider is picked; when "local-stt" is picked, `model` is its model.
   */
  local?: LocalServer
}

export const DEFAULT_SETTINGS: SttSettings = {
  provider: 'openai',
  model: DEFAULT_OPENAI_MODEL,
  language: '',
}

/** Non-secret clean-up settings, kept in localStorage. */
export interface TextSettings {
  provider: TextProviderId
  model: string
  /** The local text model server, once configured; same rules as SttSettings. */
  local?: LocalServer
}

/** OpenAI by default: the key already saved for speech-to-text works. */
export const DEFAULT_TEXT_SETTINGS: TextSettings = {
  provider: 'openai',
  model: DEFAULT_OPENAI_TEXT_MODEL,
}

export function createProvider(
  settings: SttSettings,
  fetchImpl: typeof fetch = fetch,
): SpeechToTextProvider {
  switch (settings.provider) {
    case 'openai':
      return createOpenAiProvider(settings.model, fetchImpl)
    case 'deepgram':
      return createDeepgramProvider(settings.model, fetchImpl)
    case 'groq':
      return createGroqProvider(settings.model, fetchImpl)
    case 'local-stt':
      if (!settings.local) {
        throw new Error('Set up the local speech-to-text server in AI keys')
      }
      return createLocalSttProvider(settings.local, fetchImpl)
  }
}

export function createTextProvider(
  provider: TextProviderId,
  local?: LocalServer,
  fetchImpl: typeof fetch = fetch,
): TextModelProvider {
  switch (provider) {
    case 'openai':
      return createOpenAiTextProvider(fetchImpl)
    case 'anthropic':
      return createAnthropicTextProvider(fetchImpl)
    case 'xai':
      return createXaiTextProvider(fetchImpl)
    case 'local-text':
      if (!local) {
        throw new Error('Set up the local text model server in AI keys')
      }
      return createLocalTextProvider(local, fetchImpl)
  }
}

/** A stored local server, or undefined when anything about it is off. */
export function normalizeLocalServer(value: unknown): LocalServer | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const v = value as Record<string, unknown>
  if (!isBaseUrl(v.baseUrl) || !isLocalModelName(v.model)) return undefined
  return { baseUrl: v.baseUrl, model: v.model }
}

export function isSttProviderId(value: unknown): value is SttProviderId {
  return (
    typeof value === 'string' && (STT_PROVIDER_IDS as string[]).includes(value)
  )
}

export function isTextProviderId(value: unknown): value is TextProviderId {
  return (
    typeof value === 'string' && (TEXT_PROVIDER_IDS as string[]).includes(value)
  )
}

/** Validates a parsed settings object; anything off falls back to defaults. */
export function normalizeSettings(value: unknown): SttSettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_SETTINGS
  const v = value as Record<string, unknown>
  const local = normalizeLocalServer(v.local)
  let provider = isSttProviderId(v.provider)
    ? v.provider
    : DEFAULT_SETTINGS.provider
  // The local provider without a server to reach is no choice at all.
  if (provider === 'local-stt' && !local) provider = DEFAULT_SETTINGS.provider
  const model =
    provider === 'local-stt' && local
      ? local.model
      : typeof v.model === 'string' &&
          STT_MODELS[provider].some((m) => m.id === v.model)
        ? v.model
        : DEFAULT_STT_MODELS[provider]
  const language =
    typeof v.language === 'string' && isLanguageHint(v.language)
      ? v.language.toLowerCase()
      : ''
  const settings: SttSettings = { provider, model, language }
  if (local) settings.local = local
  return settings
}

/**
 * Validates parsed clean-up settings. A model the provider does not list
 * falls back to that provider's default, so switching provider never keeps
 * another vendor's model id.
 */
export function normalizeTextSettings(value: unknown): TextSettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_TEXT_SETTINGS
  const v = value as Record<string, unknown>
  const local = normalizeLocalServer(v.local)
  let provider = isTextProviderId(v.provider)
    ? v.provider
    : DEFAULT_TEXT_SETTINGS.provider
  if (provider === 'local-text' && !local) {
    provider = DEFAULT_TEXT_SETTINGS.provider
  }
  const model =
    provider === 'local-text' && local
      ? local.model
      : typeof v.model === 'string' &&
          TEXT_MODELS[provider].some((m) => m.id === v.model)
        ? v.model
        : DEFAULT_TEXT_MODELS[provider]
  const settings: TextSettings = { provider, model }
  if (local) settings.local = local
  return settings
}

/**
 * ISO 639-1 two-letter codes, plus the regional Chinese tags the OpenAI
 * guide lists. Empty means auto-detect. Three-letter codes are left out:
 * the older models reject them.
 */
export function isLanguageHint(value: string): boolean {
  return value === '' || /^([a-z]{2}|zh-(cn|tw|hk))$/i.test(value)
}
