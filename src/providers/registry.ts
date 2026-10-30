/**
 * The providers VoxNote knows about and the local, non-secret settings that
 * pick one. Speech-to-text and text clean-up are chosen separately; a
 * provider that offers both (OpenAI) has one key for both. Every other
 * provider has its own key id, so a key is only ever sent to the host of
 * the provider it was saved for. The API key itself
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
import type { SpeechToTextProvider } from './stt'
import {
  createXaiTextProvider,
  DEFAULT_XAI_TEXT_MODEL,
  XAI_TEXT_MODELS,
} from './xai'

/** Every provider that may hold a key. */
export type ProviderId = 'openai' | 'anthropic' | 'xai' | 'deepgram' | 'groq'
export type SttProviderId = 'openai' | 'deepgram' | 'groq'
export type TextProviderId = 'openai' | 'anthropic' | 'xai'

export const STT_PROVIDER_IDS: readonly SttProviderId[] = [
  'openai',
  'deepgram',
  'groq',
]
export const TEXT_PROVIDER_IDS: readonly TextProviderId[] = [
  'openai',
  'anthropic',
  'xai',
]

/** One key per provider id, shared by every capability that provider has. */
export const SECRET_NAMES: Record<ProviderId, string> = {
  openai: 'openai.apiKey',
  anthropic: 'anthropic.apiKey',
  xai: 'xai.apiKey',
  deepgram: 'deepgram.apiKey',
  groq: 'groq.apiKey',
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  xai: 'xAI (Grok)',
  deepgram: 'Deepgram',
  groq: 'Groq (hosted Whisper)',
}

export const STT_MODELS: Record<
  SttProviderId,
  readonly { id: string; label: string }[]
> = {
  openai: OPENAI_MODELS,
  deepgram: DEEPGRAM_MODELS,
  groq: GROQ_MODELS,
}

export const DEFAULT_STT_MODELS: Record<SttProviderId, string> = {
  openai: DEFAULT_OPENAI_MODEL,
  deepgram: DEFAULT_DEEPGRAM_MODEL,
  groq: DEFAULT_GROQ_MODEL,
}

export const TEXT_MODELS: Record<TextProviderId, readonly TextModelInfo[]> = {
  openai: OPENAI_TEXT_MODELS,
  anthropic: ANTHROPIC_TEXT_MODELS,
  xai: XAI_TEXT_MODELS,
}

export const DEFAULT_TEXT_MODELS: Record<TextProviderId, string> = {
  openai: DEFAULT_OPENAI_TEXT_MODEL,
  anthropic: DEFAULT_ANTHROPIC_TEXT_MODEL,
  xai: DEFAULT_XAI_TEXT_MODEL,
}

/** Non-secret transcription settings, kept in localStorage. */
export interface SttSettings {
  provider: SttProviderId
  model: string
  /** ISO 639-1 hint such as "es", or empty for auto-detect. */
  language: string
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
  }
}

export function createTextProvider(
  provider: TextProviderId,
  fetchImpl: typeof fetch = fetch,
): TextModelProvider {
  switch (provider) {
    case 'openai':
      return createOpenAiTextProvider(fetchImpl)
    case 'anthropic':
      return createAnthropicTextProvider(fetchImpl)
    case 'xai':
      return createXaiTextProvider(fetchImpl)
  }
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
  const provider = isSttProviderId(v.provider)
    ? v.provider
    : DEFAULT_SETTINGS.provider
  const model =
    typeof v.model === 'string' &&
    STT_MODELS[provider].some((m) => m.id === v.model)
      ? v.model
      : DEFAULT_STT_MODELS[provider]
  const language =
    typeof v.language === 'string' && isLanguageHint(v.language)
      ? v.language.toLowerCase()
      : ''
  return { provider, model, language }
}

/**
 * Validates parsed clean-up settings. A model the provider does not list
 * falls back to that provider's default, so switching provider never keeps
 * another vendor's model id.
 */
export function normalizeTextSettings(value: unknown): TextSettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_TEXT_SETTINGS
  const v = value as Record<string, unknown>
  const provider = isTextProviderId(v.provider)
    ? v.provider
    : DEFAULT_TEXT_SETTINGS.provider
  const model =
    typeof v.model === 'string' &&
    TEXT_MODELS[provider].some((m) => m.id === v.model)
      ? v.model
      : DEFAULT_TEXT_MODELS[provider]
  return { provider, model }
}

/**
 * ISO 639-1 two-letter codes, plus the regional Chinese tags the OpenAI
 * guide lists. Empty means auto-detect. Three-letter codes are left out:
 * the older models reject them.
 */
export function isLanguageHint(value: string): boolean {
  return value === '' || /^([a-z]{2}|zh-(cn|tw|hk))$/i.test(value)
}
