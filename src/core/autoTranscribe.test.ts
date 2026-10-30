import { describe, expect, it } from 'vitest'
import {
  createConsent,
  isConsentValid,
  parseConsents,
  retainMatching,
  revokeConsent,
  standingConsentSentence,
  type AutoTranscribeConsent,
} from './autoTranscribe'

const grant = {
  documentId: 'doc-a',
  provider: 'openai',
  model: 'gpt-transcribe',
  host: 'api.openai.com',
  language: 'es',
  includeQuote: false,
  disclosure: 'Sends the recording to OpenAI. From now on, …',
}

const target = {
  documentId: 'doc-a',
  provider: 'openai',
  model: 'gpt-transcribe',
  host: 'api.openai.com',
  language: 'es',
}

describe('standing consent to transcribe on Stop', () => {
  it('states provider, host, when it applies and how to turn it off', () => {
    expect(standingConsentSentence('OpenAI', 'api.openai.com')).toBe(
      'From now on, each recording in this document is sent to OpenAI at ' +
        'api.openai.com as soon as you tap Stop. You can turn this off in ' +
        'the composer or under the key settings.',
    )
  })

  it('records the grant with a UTC timestamp', () => {
    const consent = createConsent(grant, new Date('2026-10-30T12:00:00Z'))
    expect(consent).toEqual({ ...grant, grantedAt: '2026-10-30T12:00:00.000Z' })
  })

  it('refuses a grant without a destination or a disclosure', () => {
    expect(() => createConsent({ ...grant, host: '' })).toThrow(/host/)
    expect(() => createConsent({ ...grant, documentId: ' ' })).toThrow(
      /documentId/,
    )
    expect(() => createConsent({ ...grant, disclosure: '' })).toThrow(
      /disclosure/,
    )
  })

  it('is valid only for the same document, provider, model, host and language', () => {
    const consent = createConsent(grant)
    expect(isConsentValid(consent, target)).toBe(true)
    expect(isConsentValid(null, target)).toBe(false)
    expect(isConsentValid(undefined, target)).toBe(false)
    for (const change of [
      { documentId: 'doc-b' },
      { provider: 'deepgram' },
      { model: 'whisper-1' },
      { host: 'api.example' },
      { language: '' },
    ]) {
      expect(isConsentValid(consent, { ...target, ...change })).toBe(false)
    }
  })

  it('drops consents the settings no longer match, and keeps identity otherwise', () => {
    const a = createConsent(grant)
    const b = createConsent({
      ...grant,
      documentId: 'doc-b',
      model: 'whisper-1',
    })
    const all = { 'doc-a': a, 'doc-b': b }
    const settings = {
      provider: 'openai',
      model: 'gpt-transcribe',
      language: 'es',
    }
    expect(retainMatching(all, settings)).toEqual({ 'doc-a': a })
    const onlyA = { 'doc-a': a }
    expect(retainMatching(onlyA, settings)).toBe(onlyA)
    expect(retainMatching(all, { ...settings, language: 'en' })).toEqual({})
  })

  it('revokes one document or all of them', () => {
    const a = createConsent(grant)
    const b = createConsent({ ...grant, documentId: 'doc-b' })
    const all = { 'doc-a': a, 'doc-b': b }
    expect(revokeConsent(all, 'doc-a')).toEqual({ 'doc-b': b })
    expect(all).toHaveProperty('doc-a')
    expect(revokeConsent(all, 'doc-z')).toBe(all)
    expect(revokeConsent(all, null)).toEqual({})
    const none = {}
    expect(revokeConsent(none, null)).toBe(none)
  })

  it('parses stored consents and drops anything malformed', () => {
    const a = createConsent(grant, new Date('2026-10-30T12:00:00Z'))
    const stored = JSON.parse(
      JSON.stringify({
        'doc-a': a,
        'doc-b': { ...a, documentId: 'doc-b', host: '' },
        'doc-c': { ...a, documentId: 'doc-c', grantedAt: '2026-10-30 12:00' },
        'doc-d': { ...a, documentId: 'doc-x' },
        'doc-e': { ...a, documentId: 'doc-e', includeQuote: 'yes' },
      }),
    ) as unknown
    expect(parseConsents(stored)).toEqual({ 'doc-a': a })
    expect(parseConsents(null)).toEqual({})
    expect(parseConsents([a])).toEqual({})
    expect(parseConsents('x')).toEqual({})
  })

  it('round-trips through JSON', () => {
    const a: AutoTranscribeConsent = createConsent(grant)
    expect(parseConsents(JSON.parse(JSON.stringify({ 'doc-a': a })))).toEqual({
      'doc-a': a,
    })
  })
})
