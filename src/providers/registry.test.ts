import { describe, expect, it } from 'vitest'
import {
  createProvider,
  DEFAULT_SETTINGS,
  isLanguageHint,
  normalizeSettings,
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
})
