/**
 * Small helpers shared by the speech-to-text adapters: wording for the
 * consent text, upload file names, and error text that never shows a key.
 * No network code lives here; each adapter owns its own request.
 */

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function joinNatural(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * Multipart file name for OpenAI-compatible endpoints, which pick the
 * decoder from the extension. Throws for a type the caller cannot send.
 */
export function uploadFileName(mimeType: string, providerName: string): string {
  const type = mimeType.split(';')[0].trim().toLowerCase()
  const ext: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/mp4': 'mp4',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/flac': 'flac',
  }
  const extension = ext[type]
  if (!extension) {
    throw new Error(
      `${providerName} does not accept recordings of type ${mimeType}`,
    )
  }
  return `recording.${extension}`
}

/**
 * Removes the key that was sent, wherever it appears, plus anything shaped
 * like an OpenAI-style secret. Error bodies can echo what they received.
 */
export function redact(text: string, apiKey?: string): string {
  const out = text.replace(/sk-[A-Za-z0-9_-]{4,}/g, 'sk-…')
  const key = apiKey?.trim()
  return key && key.length >= 4 ? out.split(key).join('[redacted key]') : out
}

/** Redacts before cutting, so a key split by the cut cannot leak in part. */
export function excerpt(text: string, apiKey?: string): string {
  const clean = redact(text, apiKey)
  return clean.length > 200 ? `${clean.slice(0, 200)}…` : clean
}

/**
 * Error text for OpenAI-shaped error bodies, `{ error: { message } }`, which
 * OpenAI and Groq both document. Falls back to a redacted excerpt.
 */
export function openAiStyleError(body: string, apiKey: string): string {
  try {
    const json = JSON.parse(body) as { error?: { message?: unknown } }
    if (typeof json.error?.message === 'string') {
      return redact(json.error.message, apiKey)
    }
  } catch {
    // Not JSON: fall through to the raw excerpt.
  }
  return excerpt(body, apiKey) || 'no response body'
}
