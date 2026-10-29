/**
 * Pure helpers around browser audio recording. The MediaRecorder itself is
 * driven from a hook; this module decides formats and formats numbers so
 * those decisions can be unit-tested.
 */

/**
 * Container/codec candidates in order of preference. Safari (iPadOS) records
 * MP4/AAC only; Chromium and Firefox record WebM/Opus. Both are accepted by
 * the STT providers on the roadmap.
 */
export const RECORDING_MIME_TYPES: readonly string[] = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
]

/**
 * Picks the first supported type, or throws when the browser can record
 * none of them. Silent fallback to an unknown format would hand providers
 * audio they reject later, with a worse error.
 */
export function pickRecordingMimeType(
  isTypeSupported: (type: string) => boolean,
  candidates: readonly string[] = RECORDING_MIME_TYPES,
): string {
  const found = candidates.find((type) => isTypeSupported(type))
  if (!found) {
    throw new Error(
      `This browser cannot record audio in any supported format (${candidates.join(', ')})`,
    )
  }
  return found
}

/** "0:07", "1:05", "12:30". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
