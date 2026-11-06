/**
 * Opening a document that is not on this device: a PDF or a Markdown file by
 * URL, or a PDF compiled by the IETF's author tools from an Internet-Draft's
 * XML source.
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
 * decoded, with `extension` (`.pdf` by default) appended when missing;
 * `document<extension>` for an empty path.
 */
export function fileNameFromUrl(url: URL, extension = '.pdf'): string {
  const segment = url.pathname.split('/').filter(Boolean).pop() ?? ''
  let name: string
  try {
    name = decodeURIComponent(segment)
  } catch {
    name = segment
  }
  if (!name) return `document${extension}`
  const lower = name.toLowerCase()
  if (extension === '.md' && lower.endsWith('.markdown')) return name
  return lower.endsWith(extension) ? name : `${name}${extension}`
}

/** True for `text/html` and XHTML, which a `.md` path must never pass as. */
export function isHtmlContentType(contentType: string | null): boolean {
  const type = (contentType ?? '').toLowerCase()
  return type.startsWith('text/html') || type.startsWith('application/xhtml')
}

/**
 * True when the URL or the response says the body is Markdown: a `.md` or
 * `.markdown` path, or a `text/markdown` or `text/x-markdown` content type.
 * Markdown has no magic bytes, so this is the only check there is; an HTML
 * content type wins over the path, since a forge's "blob" page or a site
 * that answers every path with its index.html is not the file.
 */
export function looksLikeMarkdown(
  url: URL,
  contentType: string | null,
): boolean {
  if (isHtmlContentType(contentType)) return false
  const type = (contentType ?? '').toLowerCase()
  const path = url.pathname.toLowerCase()
  return (
    path.endsWith('.md') ||
    path.endsWith('.markdown') ||
    type.startsWith('text/x-markdown') ||
    (contentType ?? '').toLowerCase().startsWith('text/markdown')
  )
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

function isAbort(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name: unknown }).name === 'AbortError'
  )
}

/**
 * A `fetch` rejection in the browser is a bare "Failed to fetch" that covers
 * both a network failure and a server that does not allow cross-origin
 * requests (no CORS). The message says so, since the second is the common
 * case and nothing in the app can work around it. `advice` closes the
 * sentence with what the user can do instead, if anything.
 */
function describeFetchFailure(host: string, err: unknown, advice = ''): string {
  const detail = err instanceof Error ? err.message : String(err)
  return `${host} did not answer the browser (${detail}). Either the network is down or that server does not allow web apps to reach it (no CORS)${advice}.`
}

const DOWNLOAD_ADVICE = '; in that case, download the file yourself and open it'

interface Downloaded {
  bytes: Uint8Array
  contentType: string | null
}

/** GETs `url` from the browser; rejects on a failed request or a non-2xx. */
async function download(
  url: URL,
  fetchFn: FetchFn,
  signal: AbortSignal | undefined,
  redirect: RequestRedirect,
): Promise<Downloaded> {
  let response: Response
  try {
    response = await fetchFn(url.href, { signal, redirect })
  } catch (err: unknown) {
    if (isAbort(err)) throw err
    throw new Error(describeFetchFailure(url.host, err, DOWNLOAD_ADVICE))
  }
  if (!response.ok) {
    throw new Error(
      `${url.host} answered ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`,
    )
  }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get('content-type'),
  }
}

/**
 * Downloads the document at `url` into a File: a PDF (by its `%PDF-` magic)
 * or a Markdown file (by its path or content type). The request goes straight
 * from the browser to that host; nothing else is sent. Rejects when the
 * server fails, the body is neither, or the server does not allow the
 * download.
 */
export async function fetchDocument(
  url: URL,
  fetchFn: FetchFn,
  signal?: AbortSignal,
): Promise<File> {
  const { bytes, contentType } = await download(url, fetchFn, signal, 'follow')
  if (looksLikePdf(bytes)) {
    return new File([bytes as BlobPart], fileNameFromUrl(url), {
      type: 'application/pdf',
    })
  }
  if (looksLikeMarkdown(url, contentType)) {
    return new File([bytes as BlobPart], fileNameFromUrl(url, '.md'), {
      type: 'text/markdown',
    })
  }
  if (isHtmlContentType(contentType)) {
    throw new Error(
      `${url.host} sent a web page (${contentType}), not the file. Use the link to the raw file (on GitHub, the "Raw" button).`,
    )
  }
  throw new Error(
    `The file at ${url.host} is neither a PDF nor a Markdown file (${contentType ?? 'unknown type'}).`,
  )
}

/**
 * Downloads the PDF at `url` into a File; anything else is refused. Used for
 * links a service returned, where the kind is known in advance.
 */
export async function fetchPdf(
  url: URL,
  fetchFn: FetchFn,
  signal?: AbortSignal,
  options: { redirect?: RequestRedirect } = {},
): Promise<File> {
  const { bytes, contentType } = await download(
    url,
    fetchFn,
    signal,
    options.redirect ?? 'follow',
  )
  if (!looksLikePdf(bytes)) {
    throw new Error(
      `The file at ${url.host} is not a PDF (${contentType ?? 'unknown type'}).`,
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
  return `"${file.name}" (${formatSize(file.size)}) is uploaded to ${new URL(AUTHOR_TOOLS_HOST).host}, the IETF's author tools, which compile it with xml2rfc and return a PDF. The PDF stays on that server under the link it returns, for as long as the IETF keeps it. Nothing else is sent.`
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
  const origin = new URL(AUTHOR_TOOLS_HOST).origin
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
  if (!pdfUrl || pdfUrl.origin !== origin) {
    throw new Error(
      `${host} returned a PDF link outside ${origin} (${String(payload.url)}); refusing to follow it.`,
    )
  }
  // The same-origin check covers the link itself, so a redirect from it is
  // refused rather than followed somewhere else.
  const downloaded = await fetchPdf(pdfUrl, fetchFn, signal, {
    redirect: 'error',
  })
  const name = xml.name.replace(/\.xml$/i, '') + '.pdf'
  const pdf = new File([downloaded], name, { type: 'application/pdf' })
  return { pdf, warnings: stringList(payload.logs?.warnings) }
}
