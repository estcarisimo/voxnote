/**
 * Hands a file to the browser as a download. Everything stays on this
 * device: the data becomes an object URL that is revoked shortly after.
 */
export function downloadFile(
  data: BlobPart,
  filename: string,
  mimeType: string,
): void {
  const blob = new Blob([data], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** "paper.pdf" → "paper", so exports can add their own suffix. */
export function baseName(filename: string): string {
  return filename.replace(/\.pdf$/i, '')
}
