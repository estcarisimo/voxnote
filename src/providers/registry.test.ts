import { describe, expect, it } from 'vitest'
import {
  createProvider,
  createTextProvider,
  DEFAULT_SETTINGS,
  DEFAULT_STT_MODELS,
  DEFAULT_TEXT_SETTINGS,
  isLanguageHint,
  normalizeSettings,
  normalizeTextSettings,
  SECRET_NAMES,
  STT_MODELS,
  STT_PROVIDER_IDS,
  TEXT_MODELS,
  TEXT_PROVIDER_IDS,
} from './registry'

describe('provider registry', () => {
  it('normalizes stored settings and falls back to defaults', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(
      normalizeSettings({ provider: 'nope', model: 'x', language: 1 }),
    ).toEqual(DEFAULT_SETTINGS)
    expect(
      normalizeSettings({
        provider: 'openai',
        model: 'whisper-1',
        language: 'ES',
      }),
    ).toEqual({ provider: 'openai', model: 'whisper-1', language: 'es' })
    expect(normalizeSettings({ language: 'spanish' }).language).toBe('')
    expect(normalizeSettings({ language: 'zh-cn' }).language).toBe('zh-cn')
    expect(normalizeSettings({ language: 'spa' }).language).toBe('')
  })

  it('validates language hints', () => {
    expect(isLanguageHint('')).toBe(true)
    expect(isLanguageHint('es')).toBe(true)
    expect(isLanguageHint('EN')).toBe(true)
    expect(isLanguageHint('zh-tw')).toBe(true)
    expect(isLanguageHint('e')).toBe(false)
    expect(isLanguageHint('es-ar')).toBe(false)
    expect(isLanguageHint('spanish')).toBe(false)
  })

  it('creates the provider the settings name', () => {
    const p = createProvider(DEFAULT_SETTINGS)
    expect(p.id).toBe('openai')
    expect(p.endpointHost).toBe('api.openai.com')
  })

  it("normalizes clean-up settings, never keeping another vendor's model", () => {
    expect(normalizeTextSettings(undefined)).toEqual(DEFAULT_TEXT_SETTINGS)
    expect(DEFAULT_TEXT_SETTINGS).toEqual({
      provider: 'openai',
      model: 'gpt-6.1-terra',
    })
    expect(
      normalizeTextSettings({
        provider: 'anthropic',
        model: 'claude-haiku-5-5',
      }),
    ).toEqual({ provider: 'anthropic', model: 'claude-haiku-5-5' })
    expect(
      normalizeTextSettings({ provider: 'xai', model: 'claude-haiku-5-5' }),
    ).toEqual({ provider: 'xai', model: 'grok-4.7' })
    expect(normalizeTextSettings({ provider: 'gemini', model: 'x' })).toEqual(
      DEFAULT_TEXT_SETTINGS,
    )
  })

  it('creates every text provider with its own host and models, and one key name each', () => {
    const hosts = TEXT_PROVIDER_IDS.map((id) => {
      const p = createTextProvider(id)
      expect(p.id).toBe(id)
      expect(p.models).toBe(TEXT_MODELS[id])
      return p.endpointHost
    })
    expect(hosts).toEqual(['api.openai.com', 'api.anthropic.com', 'api.x.ai'])
    expect(new Set(Object.values(SECRET_NAMES)).size).toBe(
      Object.keys(SECRET_NAMES).length,
    )
  })

  it('creates every speech-to-text provider with its own host, models and key', () => {
    const made = STT_PROVIDER_IDS.map((id) => {
      const p = createProvider({
        provider: id,
        model: DEFAULT_STT_MODELS[id],
        language: '',
      })
      expect(p.id).toBe(id)
      expect(STT_MODELS[id].some((m) => m.id === DEFAULT_STT_MODELS[id])).toBe(
        true,
      )
      return [p.endpointHost, p.acceptsPrompt, SECRET_NAMES[id]]
    })
    expect(made).toEqual([
      ['api.openai.com', true, 'openai.apiKey'],
      ['api.deepgram.com', false, 'deepgram.apiKey'],
      ['api.groq.com', true, 'groq.apiKey'],
    ])
  })

  it('keeps a speech-to-text model only for its own provider', () => {
    expect(
      normalizeSettings({
        provider: 'deepgram',
        model: 'nova-2',
        language: '',
      }),
    ).toEqual({ provider: 'deepgram', model: 'nova-2', language: '' })
    expect(
      normalizeSettings({ provider: 'groq', model: 'gpt-transcribe' }),
    ).toEqual({
      provider: 'groq',
      model: 'whisper-large-v3-turbo',
      language: '',
    })
    expect(
      normalizeSettings({ provider: 'deepgram', model: 'whisper-large-v3' })
        .model,
    ).toBe('nova-3')
  })
})
