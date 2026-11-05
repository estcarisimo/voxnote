import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTHOR_TOOLS_HOST } from '../core/remotePdf'
import { RenderDraftDialog } from './RenderDraftDialog'

const xml = new File(['<rfc/>'], 'draft-x-04.xml', { type: 'text/xml' })
const exportUrl = `${AUTHOR_TOOLS_HOST}/api/export/abc/draft-x-04.pdf`

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function pdfResponse(): Response {
  return new Response('%PDF-1.7 fake', {
    status: 200,
    headers: { 'content-type': 'application/pdf' },
  })
}

describe('RenderDraftDialog', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends nothing until Send is tapped and states what is uploaded', () => {
    const fetchFn = vi.fn()
    vi.stubGlobal('fetch', fetchFn)
    render(<RenderDraftDialog xml={xml} onDone={vi.fn()} onCancel={vi.fn()} />)
    expect(
      screen.getByRole('dialog', { name: /Compile this Internet-Draft/ })
        .textContent,
    ).toContain('"draft-x-04.xml"')
    expect(screen.getByRole('dialog').textContent).toContain(
      'author-tools.ietf.org',
    )
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('uploads on Send and hands the PDF over when there are no warnings', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ url: exportUrl, logs: { errors: [], warnings: [] } }),
      )
      .mockResolvedValueOnce(pdfResponse())
    vi.stubGlobal('fetch', fetchFn)
    const onDone = vi.fn()
    render(<RenderDraftDialog xml={xml} onDone={onDone} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^Send to/ }))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    const pdf = onDone.mock.calls[0][0] as File
    expect(pdf.name).toBe('draft-x-04.pdf')
    expect(fetchFn.mock.calls[0][0]).toBe(`${AUTHOR_TOOLS_HOST}/api/render/pdf`)
  })

  it('shows xml2rfc warnings before opening', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            url: exportUrl,
            logs: { errors: [], warnings: ['(21) The document date is old'] },
          }),
        )
        .mockResolvedValueOnce(pdfResponse()),
    )
    const onDone = vi.fn()
    render(<RenderDraftDialog xml={xml} onDone={onDone} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^Send to/ }))
    const list = await screen.findByRole('list', { name: 'xml2rfc warnings' })
    expect(list.textContent).toContain('(21) The document date is old')
    expect(onDone).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Open the PDF' }))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('shows the service error and keeps the dialog open', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'No file' }, 400)),
    )
    const onDone = vi.fn()
    render(<RenderDraftDialog xml={xml} onDone={onDone} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^Send to/ }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'xml2rfc could not compile the draft: No file',
    )
    expect(onDone).not.toHaveBeenCalled()
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: /^Send to/ })
        .disabled,
    ).toBe(false)
  })

  it('aborts the request on Cancel while sending', async () => {
    let signal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_input: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            signal = init?.signal ?? undefined
            signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            )
          }),
      ),
    )
    const onCancel = vi.fn()
    render(<RenderDraftDialog xml={xml} onDone={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /^Send to/ }))
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Compiling…' })
        .disabled,
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(signal?.aborted).toBe(true))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
