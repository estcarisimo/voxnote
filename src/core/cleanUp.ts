/**
 * Pure rules for the optional LLM clean-up of a dictated note. A clean-up is
 * only ever a proposal: it is checked here before the user sees it, and it
 * reaches the note's editable body only when the user accepts it. The raw
 * transcript is never changed.
 */
import { isCleanUp, withBody, type CleanUp, type Note } from './annotations'

/** A checked clean-up waiting for the user's Accept or Discard. */
export interface CleanUpProposal {
  /** The polished text, as the model returned it. */
  text: string
  cleanUp: CleanUp
}

/**
 * How far a clean-up may move the length of the raw text. Punctuation,
 * casing and dropped fillers change the length a little; a result outside
 * these bounds is an answer, a summary or an expansion, not a clean-up.
 * The proposed length L passes when it is within `slackChars` of the raw
 * length R, or when L / R is within [minRatio, maxRatio]. The slack keeps
 * very short notes ("um, typo here") from failing on a ratio alone.
 */
export const CLEAN_UP_LENGTH_LIMITS = {
  minRatio: 0.5,
  maxRatio: 1.5,
  slackChars: 20,
} as const

/** Whitespace-insensitive comparison, so "a  b" and "a b " count as equal. */
function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

/**
 * Throws when `proposed` must not be offered as a clean-up of `raw`: empty,
 * identical, or of a wildly different length. Nothing is accepted silently.
 */
export function assertCleanUpAcceptable(raw: string, proposed: string): void {
  if (normalize(raw) === '') {
    throw new Error('There is no raw transcript to polish')
  }
  const p = normalize(proposed)
  if (p === '') {
    throw new Error('The model returned an empty answer; nothing changed')
  }
  if (p === normalize(raw)) {
    throw new Error(
      'The model returned the transcript unchanged; nothing to polish',
    )
  }
  const r = normalize(raw).length
  const { minRatio, maxRatio, slackChars } = CLEAN_UP_LENGTH_LIMITS
  const ratio = p.length / r
  if (
    Math.abs(p.length - r) > slackChars &&
    (ratio < minRatio || ratio > maxRatio)
  ) {
    throw new Error(
      `The polished text is ${p.length} characters for a ${r}-character transcript ` +
        `(${Math.round(ratio * 100)}%); a polished text stays within ` +
        `${minRatio * 100}–${maxRatio * 100}% of the length, so it was rejected`,
    )
  }
}

/** Checks a proposal for a raw transcript; returns it unchanged when fine. */
export function checkProposal(
  raw: string,
  proposal: CleanUpProposal,
): CleanUpProposal {
  if (!isCleanUp(proposal.cleanUp)) {
    throw new Error(
      `Invalid polish record: ${JSON.stringify(proposal.cleanUp)}`,
    )
  }
  assertCleanUpAcceptable(raw, proposal.text)
  return proposal
}

/**
 * Applies an accepted clean-up to a stored note: the polished text becomes
 * the editable body and the note records where it came from. The raw
 * transcript stays exactly as it was.
 */
export function withCleanUp<N extends Note>(
  note: N,
  proposal: CleanUpProposal,
  now: Date = new Date(),
): N {
  const transcript = note.voice?.transcript
  if (!transcript) {
    throw new Error(`Note ${note.id} has no raw transcript to polish`)
  }
  checkProposal(transcript.raw, proposal)
  // withBody runs the suggestion and comment invariants on the new text;
  // the record it carries over is replaced by the new one.
  const updated = withBody(note, proposal.text, now)
  const record: CleanUp = { ...proposal.cleanUp }
  delete record.editedAfter
  updated.cleanUp = record
  return updated
}

/**
 * The clean-up record for a note about to be saved from the composer: the
 * accepted proposal, flagged as edited when the text was changed after.
 */
export function cleanUpForDraft(
  proposal: CleanUpProposal,
  body: string,
): CleanUp {
  const record: CleanUp = { ...proposal.cleanUp }
  delete record.editedAfter
  if (body !== proposal.text) record.editedAfter = true
  return record
}

/** "anthropic/claude-opus-5-5", the label the sidebar and exports show. */
export function cleanUpLabel(cleanUp: CleanUp): string {
  return `${cleanUp.provider}/${cleanUp.model}`
}
