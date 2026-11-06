import { describe, expect, it, vi } from 'vitest'
import {
  AUTHOR_TOOLS_HOST,
  describeDraftUpload,
  fetchDocument,
  fetchPdf,
  fileNameFromUrl,
  isDraftXmlFile,
  looksLikeMarkdown,
  looksLikePdf,
  parseHttpUrl,
  renderDraftPdf,
  type FetchFn,
} from './remotePdf'

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7 fake')

function pdfResponse(bytes: Uint8Array = PDF_BYTES, status = 200): Response {
  return new Response(bytes as BlobPart, {
    status,
    headers: { 'content-type': 'application/pdf' },
  })
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('parseHttpUrl', () => {
  it('accepts http and https with surrounding whitespace', () => {
    expect(
      parseHttpUrl('  https://www.rfc-editor.org/rfc/rfc9000.pdf ')?.href,
    ).toBe('https://www.rfc-editor.org/rfc/rfc9000.pdf')
    expect(parseHttpUrl('http://example.org/a.pdf')?.protocol).toBe('http:')
  })

  it('rejects other schemes and non-URLs', () => {
    expect(parseHttpUrl('file:///etc/passwd')).toBeNull()
    expect(parseHttpUrl('javascript:alert(1)')).toBeNull()
    expect(parseHttpUrl('rfc9000.pdf')).toBeNull()
    expect(parseHttpUrl('')).toBeNull()
  })
})

describe('fileNameFromUrl', () => {
  it('takes the last path segment and keeps .pdf', () => {
    expect(fileNameFromUrl(new URL('https://h/rfc/rfc9000.pdf?x=1'))).toBe(
      'rfc9000.pdf',
    )
  })

  it('appends .pdf when the segment has no extension and decodes it', () => {
    expect(fileNameFromUrl(new URL('https://h/doc/pdf/draft-x-04'))).toBe(
      'draft-x-04.pdf',
    )
    expect(fileNameFromUrl(new URL('https://h/my%20paper.PDF'))).toBe(
      'my paper.PDF',
    )
  })

  it('falls back for an empty path', () => {
    expect(fileNameFromUrl(new URL('https://h/'))).toBe('document.pdf')
    expect(fileNameFromUrl(new URL('https://h/'), '.md')).toBe('document.md')
  })

  it('appends another extension when asked', () => {
    expect(fileNameFromUrl(new URL('https://h/notes'), '.md')).toBe('notes.md')
    expect(fileNameFromUrl(new URL('https://h/README.md'), '.md')).toBe(
      'README.md',
    )
    expect(fileNameFromUrl(new URL('https://h/README.markdown'), '.md')).toBe(
      'README.markdown',
    )
  })
})

describe('looksLikeMarkdown', () => {
  it('goes by the path or the content type', () => {
    expect(looksLikeMarkdown(new URL('https://h/a/README.md'), null)).toBe(true)
    expect(looksLikeMarkdown(new URL('https://h/a.markdown'), null)).toBe(true)
    expect(
      looksLikeMarkdown(
        new URL('https://h/raw/notes'),
        'text/markdown; charset=utf-8',
      ),
    ).toBe(true)
    expect(looksLikeMarkdown(new URL('https://h/a.txt'), 'text/plain')).toBe(
      false,
    )
    expect(
      looksLikeMarkdown(new URL('https://h/a.md'), 'text/x-markdown'),
    ).toBe(true)
  })

  it('never passes an HTML page as Markdown, whatever the path says', () => {
    expect(
      looksLikeMarkdown(
        new URL('https://h/blob/main/README.md'),
        'text/html; charset=utf-8',
      ),
    ).toBe(false)
    expect(
      looksLikeMarkdown(new URL('https://h/a.md'), 'application/xhtml+xml'),
    ).toBe(false)
  })
})

describe('looksLikePdf', () => {
  it('checks the magic bytes', () => {
    expect(looksLikePdf(PDF_BYTES)).toBe(true)
    expect(looksLikePdf(new TextEncoder().encode('<!DOCTYPE html>'))).toBe(
      false,
    )
    expect(looksLikePdf(new Uint8Array([0x25, 0x50]))).toBe(false)
  })
})

describe('fetchPdf', () => {
  it('downloads the bytes into a File named after the URL', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(pdfResponse())
    const file = await fetchPdf(
      new URL('https://www.rfc-editor.org/rfc/rfc9000.pdf'),
      fetchFn,
    )
    expect(fetchFn).toHaveBeenCalledWith(
      'https://www.rfc-editor.org/rfc/rfc9000.pdf',
      expect.objectContaining({ redirect: 'follow' }),
    )
    expect(file.name).toBe('rfc9000.pdf')
    expect(file.type).toBe('application/pdf')
    expect(await file.text()).toBe('%PDF-1.7 fake')
  })

  it('explains a rejected fetch as network or missing CORS', async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(
      fetchPdf(new URL('https://www.ietf.org/archive/id/d.txt'), fetchFn),
    ).rejects.toThrow(/www\.ietf\.org did not answer.*Failed to fetch.*CORS/)
  })

  it('passes an abort through unchanged', async () => {
    const abort = new DOMException('aborted', 'AbortError')
    const fetchFn = vi.fn<FetchFn>().mockRejectedValue(abort)
    await expect(fetchPdf(new URL('https://h/a.pdf'), fetchFn)).rejects.toBe(
      abort,
    )
  })

  it('reports a non-2xx status', async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValue(
        new Response('nope', { status: 404, statusText: 'Not Found' }),
      )
    await expect(fetchPdf(new URL('https://h/a.pdf'), fetchFn)).rejects.toThrow(
      'h answered 404 Not Found.',
    )
  })

  it('rejects a body that is not a PDF with its content type', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(
      new Response('<html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    )
    await expect(
      fetchPdf(new URL('https://h/d.html'), fetchFn),
    ).rejects.toThrow('The file at h is not a PDF (text/html; charset=utf-8).')
  })
})

describe('fetchDocument', () => {
  it('returns a PDF by its magic bytes whatever the path says', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(pdfResponse())
    const file = await fetchDocument(new URL('https://h/doc/pdf/x'), fetchFn)
    expect(file.name).toBe('x.pdf')
    expect(file.type).toBe('application/pdf')
  })

  it('returns Markdown by its path, keeping the name', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(
      new Response('# Title\n\nBody', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      }),
    )
    const file = await fetchDocument(
      new URL('https://raw.example/repo/main/README.md'),
      fetchFn,
    )
    expect(file.name).toBe('README.md')
    expect(file.type).toBe('text/markdown')
    expect(await file.text()).toBe('# Title\n\nBody')
  })

  it('returns Markdown by its content type when the path has no extension', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(
      new Response('# T', {
        status: 200,
        headers: { 'content-type': 'text/markdown; charset=utf-8' },
      }),
    )
    const file = await fetchDocument(new URL('https://h/notes'), fetchFn)
    expect(file.name).toBe('notes.md')
    expect(file.type).toBe('text/markdown')
  })

  it('refuses an HTML page at a .md path and points at the raw file', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(
      new Response('<!DOCTYPE html><title>README.md · repo</title>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    )
    await expect(
      fetchDocument(
        new URL('https://forge.example/repo/blob/main/README.md'),
        fetchFn,
      ),
    ).rejects.toThrow(
      'forge.example sent a web page (text/html; charset=utf-8), not the file. Use the link to the raw file (on GitHub, the "Raw" button).',
    )
  })

  it('accepts a .markdown path and keeps its name', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(
      new Response('# T', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    )
    const file = await fetchDocument(
      new URL('https://h/notes.markdown'),
      fetchFn,
    )
    expect(file.name).toBe('notes.markdown')
    expect(file.type).toBe('text/markdown')
  })

  it('follows redirects for user links', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(pdfResponse())
    await fetchDocument(new URL('https://h/a.pdf'), fetchFn)
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ redirect: 'follow' })
  })

  it('rejects anything else with its content type', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(
      new Response('PK..', {
        status: 200,
        headers: { 'content-type': 'application/zip' },
      }),
    )
    await expect(
      fetchDocument(new URL('https://h/archive.zip'), fetchFn),
    ).rejects.toThrow(
      'The file at h is neither a PDF nor a Markdown file (application/zip).',
    )
  })

  it('explains a rejected fetch as network or missing CORS', async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(
      fetchDocument(new URL('https://h/a.md'), fetchFn),
    ).rejects.toThrow(/h did not answer.*no CORS.*download the file yourself/)
  })
})

describe('isDraftXmlFile', () => {
  it('accepts XML by type or extension', () => {
    expect(isDraftXmlFile(new File([''], 'd.xml'))).toBe(true)
    expect(isDraftXmlFile(new File([''], 'd', { type: 'text/xml' }))).toBe(true)
    expect(
      isDraftXmlFile(new File([''], 'd', { type: 'application/xml' })),
    ).toBe(true)
    expect(
      isDraftXmlFile(new File([''], 'd.txt', { type: 'text/plain' })),
    ).toBe(false)
  })
})

describe('describeDraftUpload', () => {
  it('names the file, its size and the host', () => {
    const text = describeDraftUpload(
      new File(['x'.repeat(2048)], 'draft-x-04.xml'),
    )
    expect(text).toContain('"draft-x-04.xml" (2 KB)')
    expect(text).toContain('author-tools.ietf.org')
    expect(text).toContain('xml2rfc')
  })
})

describe('renderDraftPdf', () => {
  const xml = new File(['<rfc/>'], 'draft-x-04.xml', { type: 'text/xml' })
  const exportUrl = `${AUTHOR_TOOLS_HOST}/api/export/abc/draft-x-04.pdf`

  it('uploads the XML, follows the link and names the PDF after the XML', async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(
        jsonResponse({
          url: exportUrl,
          logs: { errors: [], warnings: ['(21) date is old'] },
        }),
      )
      .mockResolvedValueOnce(pdfResponse())
    const { pdf, warnings } = await renderDraftPdf(xml, fetchFn)

    const [endpoint, init] = fetchFn.mock.calls[0]
    expect(endpoint).toBe(`${AUTHOR_TOOLS_HOST}/api/render/pdf`)
    expect(init?.method).toBe('POST')
    const body = init?.body as FormData
    expect(body.get('file')).toBeInstanceOf(File)
    expect((body.get('file') as File).name).toBe('draft-x-04.xml')
    expect(fetchFn.mock.calls[1][0]).toBe(exportUrl)

    expect(pdf.name).toBe('draft-x-04.pdf')
    expect(pdf.type).toBe('application/pdf')
    expect(await pdf.text()).toBe('%PDF-1.7 fake')
    expect(warnings).toEqual(['(21) date is old'])
  })

  it('surfaces the service error verbatim', async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValue(jsonResponse({ error: 'No file' }, 400))
    await expect(renderDraftPdf(xml, fetchFn)).rejects.toThrow(
      'xml2rfc could not compile the draft: No file',
    )
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('treats xml2rfc errors in the logs as a failure', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(
      jsonResponse({
        url: exportUrl,
        logs: { errors: ['(3) bad element'], warnings: [] },
      }),
    )
    await expect(renderDraftPdf(xml, fetchFn)).rejects.toThrow(
      'xml2rfc could not compile the draft: (3) bad element',
    )
  })

  it('rejects a non-JSON answer', async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValue(new Response('<html>', { status: 502 }))
    await expect(renderDraftPdf(xml, fetchFn)).rejects.toThrow(
      'author-tools.ietf.org answered 502 without the expected JSON.',
    )
  })

  it('refuses a PDF link outside the author-tools origin', async () => {
    for (const url of [
      'https://evil.example/x.pdf',
      'http://author-tools.ietf.org/api/export/abc/x.pdf',
    ]) {
      const fetchFn = vi.fn<FetchFn>().mockResolvedValue(jsonResponse({ url }))
      await expect(renderDraftPdf(xml, fetchFn)).rejects.toThrow(
        `outside ${AUTHOR_TOOLS_HOST} (${url})`,
      )
      expect(fetchFn).toHaveBeenCalledTimes(1)
    }
  })

  it('does not follow a redirect from the PDF link', async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(jsonResponse({ url: exportUrl }))
      .mockResolvedValueOnce(pdfResponse())
    await renderDraftPdf(xml, fetchFn)
    expect(fetchFn.mock.calls[1][1]).toMatchObject({ redirect: 'error' })
  })

  it('explains a rejected upload', async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(renderDraftPdf(xml, fetchFn)).rejects.toThrow(
      /author-tools\.ietf\.org did not answer.*\(no CORS\)\.$/,
    )
  })
})
