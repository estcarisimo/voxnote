/**
 * The providers VoxNote knows about and the local, non-secret settings that
 * pick one. The API key itself lives in the encrypted secret store under
 * `SECRET_NAMES[id]`; nothing here reads or writes it.
 */
import {
  createOpenAiProvider,
  DEFAULT_OPENAI_MODEL,
  OPENAI_MODELS,
} from './openai'
import type { SpeechToTextProvider } from './stt'

export type ProviderId = 'openai'

export const PROVIDER_IDS: readonly ProviderId[] = ['openai']

export const SECRET_NAMES: Record<ProviderId, string> = {
  openai: 'openai.apiKey',
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'OpenAI',
}

export const MODELS: Record<
  ProviderId,
  readonly { id: string; label: string }[]
> = {
  openai: OPENAI_MODELS,
}

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  openai: DEFAULT_OPENAI_MODEL,
}

/** Non-secret transcription settings, kept in localStorage. */
export interface SttSettings {
  provider: ProviderId
  model: string
  /** ISO 639-1 hint such as "es", or empty for auto-detect. */
  language: string
}

export const DEFAULT_SETTINGS: SttSettings = {
  provider: 'openai',
  model: DEFAULT_OPENAI_MODEL,
  language: '',
}

export function createProvider(
  settings: SttSettings,
  fetchImpl: typeof fetch = fetch,
): SpeechToTextProvider {
  switch (settings.provider) {
    case 'openai':
      return createOpenAiProvider(settings.model, fetchImpl)
  }
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as string[]).includes(value)
}

/** Validates a parsed settings object; anything off falls back to defaults. */
export function normalizeSettings(value: unknown): SttSettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_SETTINGS
  const v = value as Record<string, unknown>
  const provider = isProviderId(v.provider)
    ? v.provider
    : DEFAULT_SETTINGS.provider
  const model =
    typeof v.model === 'string' &&
    MODELS[provider].some((m) => m.id === v.model)
      ? v.model
      : DEFAULT_MODELS[provider]
  const language =
    typeof v.language === 'string' &&
    /^[a-z]{2,3}(-[a-z]{2})?$/i.test(v.language)
      ? v.language.toLowerCase()
      : ''
  return { provider, model, language }
}
