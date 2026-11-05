/**
 * Opening a PDF that is not on this device: by URL, or by having the IETF's
 * author tools compile an Internet-Draft's XML source into a PDF.
 *
 * Framework-free. `fetch` is injected so the tests stay deterministic and so
 * the rest of the app never guesses which host a request went to.
 */

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

/** Where the IETF runs xml2rfc for anyone: https://author-tools.ietf.org. */
export const AUTHOR_TOOLS_HOST = 'https://author-tools.ietf.org'
const RENDER_PDF_ENDPOINT = `${AUTHOR_TOOLS_HOST}/api/render/pdf`

/**
 * The url is an absolute http(s) URL, the only kind a browser can download
 * into the app. Returns the parsed URL, or null.
 */
export function parseHttpUrl(text: string): URL | null {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  return url
}

/**
 * A file name for a document downloaded from `url`: the last path segment,
 * decoded, with `.pdf` appended when missing; `document.pdf` for an empty
 * path.
 */
export function fileNameFromUrl(url: URL): string {
  const segment = url.pathname.split('/').filter(Boolean).pop() ?? ''
  let name: string
  try {
    name = decodeURIComponent(segment)
  } catch {
    name = segment
  }
  if (!name) return 'document.pdf'
  return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`
}

/** True when the bytes start with the `%PDF-` magic. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  )
}

/**
 * A `fetch` rejection in the browser is a bare "Failed to fetch" that covers
 * both a network failure and a server that does not allow cross-origin
 * downloads (no CORS). The message says so, since the second is the common
 * case and nothing in the app can work around it.
 */
function isAbort(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name: unknown }).name === 'AbortError'
  )
}

function describeFetchFailure(host: string, err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err)
  return `${host} did not answer the browser (${detail}). Either the network is down or that server does not allow web apps to download from it (no CORS); in that case, download the file yourself and open it.`
}

/**
 * Downloads the PDF at `url` into a File. The request goes straight from the
 * browser to that host; nothing else is sent. Rejects when the server fails,
 * the body is not a PDF or the server does not allow the download.
 */
export async function fetchPdf(
  url: URL,
  fetchFn: FetchFn,
  signal?: AbortSignal,
): Promise<File> {
  let response: Response
  try {
    response = await fetchFn(url.href, { signal, redirect: 'follow' })
  } catch (err: unknown) {
    if (isAbort(err)) throw err
    throw new Error(describeFetchFailure(url.host, err))
  }
  if (!response.ok) {
    throw new Error(
      `${url.host} answered ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`,
    )
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (!looksLikePdf(bytes)) {
    const type = response.headers.get('content-type') ?? 'unknown type'
    throw new Error(
      `The file at ${url.host} is not a PDF (${type}). Internet-Drafts are published as text, HTML and XML; open the XML with "Open an Internet-Draft" instead.`,
    )
  }
  return new File([bytes as BlobPart], fileNameFromUrl(url), {
    type: 'application/pdf',
  })
}

/** The XML source of an Internet-Draft, as the user picked it. */
export function isDraftXmlFile(file: File): boolean {
  return (
    file.type === 'text/xml' ||
    file.type === 'application/xml' ||
    file.name.toLowerCase().endsWith('.xml')
  )
}

/**
 * The sentence shown before the XML leaves the device: the file, its size,
 * the host and what comes back.
 */
export function describeDraftUpload(file: File): string {
  return `"${file.name}" (${formatSize(file.size)}) is uploaded to ${new URL(AUTHOR_TOOLS_HOST).host}, the IETF's author tools, which compile it with xml2rfc and return a PDF. The IETF keeps the PDF on that server for a while under an unguessable link. Nothing else is sent.`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export interface RenderedDraft {
  pdf: File
  /** xml2rfc warnings, verbatim, for the user to read; never hidden. */
  warnings: readonly string[]
}

interface RenderResponse {
  url?: unknown
  error?: unknown
  logs?: { errors?: unknown; warnings?: unknown }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : []
}

/**
 * Uploads a draft's XML to author-tools.ietf.org, which runs xml2rfc and
 * answers with a link to the PDF, then downloads that PDF. Two requests, both
 * to the same host. The PDF file is named after the XML file.
 */
export async function renderDraftPdf(
  xml: File,
  fetchFn: FetchFn,
  signal?: AbortSignal,
): Promise<RenderedDraft> {
  const host = new URL(AUTHOR_TOOLS_HOST).host
  const body = new FormData()
  body.append('file', xml, xml.name)
  let response: Response
  try {
    response = await fetchFn(RENDER_PDF_ENDPOINT, {
      method: 'POST',
      body,
      signal,
    })
  } catch (err: unknown) {
    if (isAbort(err)) throw err
    throw new Error(describeFetchFailure(host, err))
  }
  let payload: RenderResponse
  try {
    payload = (await response.json()) as RenderResponse
  } catch {
    throw new Error(
      `${host} answered ${response.status} without the expected JSON.`,
    )
  }
  if (typeof payload.error === 'string') {
    throw new Error(`xml2rfc could not compile the draft: ${payload.error}`)
  }
  const errors = stringList(payload.logs?.errors)
  if (errors.length > 0) {
    throw new Error(`xml2rfc could not compile the draft: ${errors.join('; ')}`)
  }
  if (!response.ok || typeof payload.url !== 'string') {
    throw new Error(`${host} answered ${response.status} without a PDF link.`)
  }
  const pdfUrl = parseHttpUrl(payload.url)
  if (!pdfUrl || pdfUrl.host !== host) {
    throw new Error(
      `${host} returned a PDF link on another host (${String(payload.url)}); refusing to follow it.`,
    )
  }
  const downloaded = await fetchPdf(pdfUrl, fetchFn, signal)
  const name = xml.name.replace(/\.xml$/i, '') + '.pdf'
  const pdf = new File([downloaded], name, { type: 'application/pdf' })
  return { pdf, warnings: stringList(payload.logs?.warnings) }
}
