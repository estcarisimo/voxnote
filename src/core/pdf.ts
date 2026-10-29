/**
 * Framework-free helpers around pdf.js. Everything that touches a PDF goes
 * through this module so the rest of the app never imports pdfjs-dist
 * directly.
 */
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

/** Stable identifier for a document: SHA-256 of its bytes, hex-encoded. */
export async function computeDocumentId(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}

/**
 * Loads a PDF from raw bytes. The bytes are copied before being handed to
 * pdf.js because the worker takes ownership of the buffer it receives.
 */
export async function loadDocument(
  bytes: Uint8Array,
): Promise<PDFDocumentProxy> {
  const copy = new Uint8Array(bytes)
  return pdfjs.getDocument({ data: copy }).promise
}

export function isPdfFile(file: File): boolean {
  return (
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  )
}

/** Releases the worker resources held by a document. */
export async function destroyDocument(doc: PDFDocumentProxy): Promise<void> {
  await doc.loadingTask.destroy()
}
