import type { Note, Transcript } from '../core/annotations'
import type { TranscriptArrival } from './AnnotationList'

export interface DeliveryTarget {
  /** The open document's id now, read after the wait. */
  currentDocumentId: () => string | null
  /** Writes through the stored-note path, so `withTranscript` rules apply. */
  setTranscript: (id: string, transcript: Transcript) => Promise<unknown>
  /** Shows the note's state in the panel; null clears it. */
  onArrival: (id: string, arrival: TranscriptArrival | null) => void
}

/**
 * Hands a transcript still on its way to a note saved before it arrived.
 * A cancel (null) clears the state quietly; a failure, a refused write or a
 * document switch is shown on the note. Never rejects: the caller has
 * already closed the composer, and the panel is where the outcome shows.
 */
export async function deliverTranscript(
  note: Note,
  pending: Promise<Transcript | null>,
  target: DeliveryTarget,
): Promise<void> {
  target.onArrival(note.id, { status: 'pending' })
  try {
    const transcript = await pending
    if (!transcript) {
      target.onArrival(note.id, null)
      return
    }
    if (target.currentDocumentId() !== note.documentId) {
      throw new Error('The document changed; the transcript was not saved')
    }
    await target.setTranscript(note.id, transcript)
    target.onArrival(note.id, null)
  } catch (err: unknown) {
    target.onArrival(note.id, {
      status: 'error',
      message: `Transcription failed: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
}
