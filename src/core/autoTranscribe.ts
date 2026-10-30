/**
 * Standing consent to transcribe on Stop. A user who ticks "Also do this
 * automatically for this document" in the transcription dialog grants it for
 * one document, one provider, one model, one host and one language hint: the
 * things the disclosure named. Anything else changing makes it invalid, so a
 * consent never carries over to a destination the user was not told about.
 * Kept beside the provider settings, never in an annotation.
 */

export interface AutoTranscribeConsent {
  /** Content hash of the document the consent covers. */
  documentId: string
  /** Speech-to-text provider id, e.g. "openai". */
  provider: string
  model: string
  /** Where the audio goes, e.g. "api.openai.com". */
  host: string
  /** The language hint sent with each recording; empty for none. */
  language: string
  /** Whether the quoted passage goes along as a vocabulary hint. */
  includeQuote: boolean
  /** The exact text the user saw when granting it. */
  disclosure: string
  /** UTC, ISO 8601. */
  grantedAt: string
}

/** What a recording would be sent with right now. */
export interface AutoTranscribeTarget {
  documentId: string
  provider: string
  model: string
  host: string
  language: string
}

/** Documents keyed by id. */
export type AutoTranscribeConsents = Readonly<
  Record<string, AutoTranscribeConsent>
>

/** The sentence added to the per-upload disclosure when granting. */
export function standingConsentSentence(
  providerName: string,
  host: string,
): string {
  return (
    `From now on, each recording in this document is sent to ${providerName} ` +
    `at ${host} as soon as you tap Stop. You can turn this off in the ` +
    `composer or under the key settings.`
  )
}

export function createConsent(
  grant: Omit<AutoTranscribeConsent, 'grantedAt'>,
  now: Date = new Date(),
): AutoTranscribeConsent {
  for (const field of ['documentId', 'provider', 'model', 'host'] as const) {
    if (grant[field].trim() === '') {
      throw new Error(`A standing consent needs a ${field}`)
    }
  }
  if (grant.disclosure.trim() === '') {
    throw new Error('A standing consent needs the disclosure the user saw')
  }
  return { ...grant, grantedAt: now.toISOString() }
}

/** True when the consent covers exactly this document and destination. */
export function isConsentValid(
  consent: AutoTranscribeConsent | null | undefined,
  target: AutoTranscribeTarget,
): consent is AutoTranscribeConsent {
  return (
    !!consent &&
    consent.documentId === target.documentId &&
    consent.provider === target.provider &&
    consent.model === target.model &&
    consent.host === target.host &&
    consent.language === target.language
  )
}

/**
 * Drops every consent the current settings no longer match: a provider,
 * model or language change revokes it rather than suspending it, so
 * switching back does not quietly restore it. Returns the same object when
 * nothing changed.
 */
export function retainMatching(
  consents: AutoTranscribeConsents,
  settings: { provider: string; model: string; language: string },
): AutoTranscribeConsents {
  const kept: Record<string, AutoTranscribeConsent> = {}
  let dropped = false
  for (const [id, consent] of Object.entries(consents)) {
    if (
      consent.provider === settings.provider &&
      consent.model === settings.model &&
      consent.language === settings.language
    ) {
      kept[id] = consent
    } else {
      dropped = true
    }
  }
  return dropped ? kept : consents
}

/**
 * Removes one document's consent, or all of them with null. Returns the same
 * object when there was nothing to remove.
 */
export function revokeConsent(
  consents: AutoTranscribeConsents,
  documentId: string | null,
): AutoTranscribeConsents {
  if (documentId === null) {
    return Object.keys(consents).length === 0 ? consents : {}
  }
  if (!(documentId in consents)) return consents
  const rest = { ...consents }
  delete rest[documentId]
  return rest
}

/**
 * Validates what came back from storage. Malformed entries are dropped:
 * losing a consent only means the dialog shows again, while trusting a
 * corrupt one could send audio somewhere the user was not told about.
 */
export function parseConsents(value: unknown): AutoTranscribeConsents {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  const result: Record<string, AutoTranscribeConsent> = {}
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isConsent(entry) && entry.documentId === id) result[id] = entry
  }
  return result
}

function isConsent(value: unknown): value is AutoTranscribeConsent {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    ['documentId', 'provider', 'model', 'host', 'disclosure'].every(
      (k) => typeof v[k] === 'string' && (v[k] as string) !== '',
    ) &&
    typeof v.language === 'string' &&
    typeof v.includeQuote === 'boolean' &&
    typeof v.grantedAt === 'string' &&
    /Z$/.test(v.grantedAt) &&
    !Number.isNaN(Date.parse(v.grantedAt))
  )
}
