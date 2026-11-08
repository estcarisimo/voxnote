import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONSENT_DEFAULT, GTAG_SCRIPT_ATTRIBUTE } from './analytics'
import { OpenPdf } from './OpenPdf'

function pdfFile(name = 'paper.pdf') {
  return new File(['%PDF-1.4'], name, { type: 'application/pdf' })
}

/** Default props; a test overrides the callback it watches. */
const props = {
  onFile: vi.fn(),
  onUrl: vi.fn(),
  onDraftXml: vi.fn(),
  onImportNotes: vi.fn(),
  recentDocuments: [],
  onResume: vi.fn(),
  error: null,
}

/** Installs a `matchMedia` that answers `matches` for every query. */
function stubDisplayMode(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches } as MediaQueryList),
  )
}

describe('OpenPdf', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    for (const script of document.querySelectorAll(
      `script[${GTAG_SCRIPT_ATTRIBUTE}]`,
    )) {
      script.remove()
    }
    delete window.dataLayer
  })

  it('passes a picked file to onFile', () => {
    const onFile = vi.fn()
    const { container } = render(<OpenPdf {...props} onFile={onFile} />)
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = pdfFile()
    fireEvent.change(input, { target: { files: [file] } })
    expect(onFile).toHaveBeenCalledTimes(1)
    expect(onFile).toHaveBeenCalledWith(file)
  })

  it('passes a dropped file to onFile and clears the dragging state', () => {
    const onFile = vi.fn()
    const { container } = render(<OpenPdf {...props} onFile={onFile} />)
    const zone = container.firstElementChild!
    fireEvent.dragOver(zone)
    expect(zone.className).toContain('open-pdf--dragging')
    const file = pdfFile()
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    expect(onFile).toHaveBeenCalledWith(file)
    expect(zone.className).not.toContain('open-pdf--dragging')
  })

  it('routes a picked or dropped .json file to the notes import', () => {
    const onFile = vi.fn()
    const onImportNotes = vi.fn()
    const { container } = render(
      <OpenPdf {...props} onFile={onFile} onImportNotes={onImportNotes} />,
    )
    const notes = new File(['{}'], 'paper.voxnote.json', {
      type: 'application/json',
    })
    fireEvent.drop(container.firstElementChild!, {
      dataTransfer: { files: [notes] },
    })
    fireEvent.change(screen.getByLabelText('Notes file to import'), {
      target: { files: [notes] },
    })
    expect(onImportNotes.mock.calls).toEqual([[notes], [notes]])
    expect(onFile).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Import notes…' })).toBeTruthy()
  })

  it('sends whatever is picked in the notes picker to the import, never to open', () => {
    const onFile = vi.fn()
    const onImportNotes = vi.fn()
    render(<OpenPdf {...props} onFile={onFile} onImportNotes={onImportNotes} />)
    const pdf = pdfFile()
    fireEvent.change(screen.getByLabelText('Notes file to import'), {
      target: { files: [pdf] },
    })
    expect(onImportNotes).toHaveBeenCalledWith(pdf)
    expect(onFile).not.toHaveBeenCalled()
  })

  it('lists recent documents with UTC times and resumes the one tapped', () => {
    const onResume = vi.fn()
    const documents = [
      {
        id: 'a'.repeat(64),
        name: 'paper.pdf',
        kind: 'pdf' as const,
        lastAnnotatedAt: '2026-11-07T18:04:31.000Z',
        count: 3,
        stored: false,
      },
      {
        id: 'b'.repeat(64),
        name: null,
        kind: null,
        lastAnnotatedAt: '2026-10-01T00:00:00.000Z',
        count: 1,
        stored: true,
      },
    ]
    render(
      <OpenPdf {...props} recentDocuments={documents} onResume={onResume} />,
    )
    const items = screen
      .getByRole('heading', { name: 'Continue a review' })
      .parentElement!.querySelectorAll('li')
    expect([...items].map((li) => li.textContent)).toEqual([
      'paper.pdf3 annotations · notes saved 2026-11-07 18:04 UTCChoose file…',
      'Unnamed document bbbbbbbb…1 annotation · notes saved 2026-10-01 00:00 UTCReopen',
    ])
    fireEvent.click(screen.getByRole('button', { name: /paper\.pdf/ }))
    expect(onResume).toHaveBeenCalledWith(documents[0])
  })

  it('shows no recent list when no document has notes', () => {
    render(<OpenPdf {...props} />)
    expect(
      screen.queryByRole('heading', { name: 'Continue a review' }),
    ).toBeNull()
  })

  it('ignores a drop with no file', () => {
    const onFile = vi.fn()
    const { container } = render(<OpenPdf {...props} onFile={onFile} />)
    fireEvent.drop(container.firstElementChild!, {
      dataTransfer: { files: [] },
    })
    expect(onFile).not.toHaveBeenCalled()
  })

  it('shows the error as an alert', () => {
    render(<OpenPdf {...props} error="Not a PDF" />)
    expect(screen.getByRole('alert').textContent).toBe('Not a PDF')
  })

  it('shows no alert without an error', () => {
    render(<OpenPdf {...props} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('has one h1 and links to the repository and license in new tabs', () => {
    render(<OpenPdf {...props} />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    const repo = screen.getByRole('link', { name: 'VoxNote on GitHub' })
    expect(repo.getAttribute('href')).toBe(
      'https://github.com/estcarisimo/voxnote',
    )
    expect(repo.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByRole('link', { name: 'Repository' })).toBeNull()
    for (const name of ['VoxNote on GitHub', 'License']) {
      const link = screen.getByRole('link', { name })
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noreferrer')
    }
    expect(screen.getByRole('contentinfo').textContent).toContain(
      'Open source, MIT',
    )
  })

  it('loads the icon relative to the base URL', () => {
    const { container } = render(<OpenPdf {...props} />)
    const icon = container.querySelector<HTMLImageElement>('img.open-pdf-icon')!
    expect(icon.getAttribute('src')).toBe(`${import.meta.env.BASE_URL}icon.svg`)
  })

  it('shows the install hint when not running standalone', () => {
    stubDisplayMode(false)
    render(<OpenPdf {...props} />)
    expect(screen.getByText(/Add to Home Screen/)).toBeTruthy()
    expect(window.matchMedia).toHaveBeenCalledWith('(display-mode: standalone)')
  })

  it('shows the install hint when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    render(<OpenPdf {...props} />)
    expect(screen.getByText(/Add to Home Screen/)).toBeTruthy()
  })

  it('hides the install hint when running standalone', () => {
    stubDisplayMode(true)
    render(<OpenPdf {...props} />)
    expect(screen.queryByText(/Add to Home Screen/)).toBeNull()
  })

  it('loads no analytics script without VITE_GA_MEASUREMENT_ID', () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', '')
    render(<OpenPdf {...props} />)
    expect(
      document.querySelector(`script[${GTAG_SCRIPT_ATTRIBUTE}]`),
    ).toBeNull()
    expect(window.dataLayer).toBeUndefined()
  })

  it('loads gtag with storage denied when VITE_GA_MEASUREMENT_ID is set', () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-LANDING1')
    render(<OpenPdf {...props} />)
    const script = document.querySelector<HTMLScriptElement>(
      `script[${GTAG_SCRIPT_ATTRIBUTE}]`,
    )
    expect(script?.src).toBe(
      'https://www.googletagmanager.com/gtag/js?id=G-LANDING1',
    )
    const first = Array.from(window.dataLayer![0] as ArrayLike<unknown>)
    expect(first).toEqual(['consent', 'default', CONSENT_DEFAULT])
  })

  it('lists the three Get started steps with key links in new tabs', () => {
    render(<OpenPdf {...props} />)
    const section = screen.getByRole('region', { name: 'Get started' })
    const steps = within(section).getAllByRole('listitem')
    expect(steps).toHaveLength(3)
    expect(steps[0].textContent).toMatch(
      /^Get an API key from a speech-to-text provider: Deepgram, Groq or OpenAI\.$/,
    )
    expect(steps[1].textContent).toMatch(
      /^Optional, to polish notes: Anthropic, OpenAI or xAI\.$/,
    )
    expect(steps[2].textContent).toContain('Paste it in AI keys')
    expect(steps[2].textContent).toContain('encrypted in your browser')
    // The vendors' key pages, checked to resolve on 2026-10-30 (see the PR).
    const expected: Record<string, string> = {
      Deepgram: 'https://console.deepgram.com/',
      Groq: 'https://console.groq.com/keys',
      OpenAI: 'https://platform.openai.com/api-keys',
      Anthropic: 'https://platform.claude.com/settings/keys',
      xAI: 'https://console.x.ai/team/default/api-keys',
    }
    const links = within(section).getAllByRole('link')
    expect(links).toHaveLength(6)
    for (const link of links) {
      expect(link.getAttribute('href')).toBe(expected[link.textContent!])
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
      expect(link.getAttribute('href')).toMatch(/^https:\/\//)
    }
  })

  it('states non-affiliation and names no price on the landing', () => {
    const { container } = render(<OpenPdf {...props} />)
    const section = screen.getByRole('region', { name: 'Get started' })
    expect(section.textContent).toContain(
      'VoxNote is not affiliated with any of these companies. You pay them directly under your own account, and audio goes from your device to the provider you chose.',
    )
    // Prices go stale and the landing carries no date: none may appear.
    expect(container.textContent).not.toMatch(/[$€£]\s?\d|\d\s?(USD|EUR)/)
    expect(container.textContent).not.toMatch(/\d+\s*%/)
    // Nothing on the landing loads anything from a provider host.
    expect(
      container.querySelectorAll('img, script, iframe, link'),
    ).toHaveLength(1)
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      `${import.meta.env.BASE_URL}icon.svg`,
    )
  })

  it('places Get started after the feature cards and before the footer', () => {
    const { container } = render(<OpenPdf {...props} />)
    const order = Array.from(
      container.querySelectorAll(
        '.open-pdf-features, .open-pdf-privacy, .open-pdf-start, .open-pdf-footer',
      ),
    ).map((el) => el.className)
    expect(order).toEqual([
      'open-pdf-features',
      'open-pdf-privacy',
      'open-pdf-start',
      'open-pdf-footer',
    ])
  })

  it('mentions visit counting in the privacy line', () => {
    render(<OpenPdf {...props} />)
    const line = screen.getByText(/Google Analytics/).textContent
    expect(line).toContain('stay in this browser')
    expect(line).toContain('key lives only in this browser, client side')
    expect(line).toContain('for statistical purposes')
  })

  it('sends a parsed http(s) link to onUrl', () => {
    const onUrl = vi.fn()
    render(<OpenPdf {...props} onUrl={onUrl} />)
    const input = screen.getByLabelText('Or open from a link')
    fireEvent.change(input, {
      target: { value: ' https://example.org/paper.pdf ' },
    })
    fireEvent.submit(input.closest('form')!)
    expect(onUrl).toHaveBeenCalledTimes(1)
    expect(onUrl.mock.calls[0][0]).toBeInstanceOf(URL)
    expect((onUrl.mock.calls[0][0] as URL).href).toBe(
      'https://example.org/paper.pdf',
    )
  })

  it('refuses a link that is not http(s) without calling onUrl', () => {
    const onUrl = vi.fn()
    render(<OpenPdf {...props} onUrl={onUrl} />)
    const input = screen.getByLabelText('Or open from a link')
    fireEvent.change(input, { target: { value: 'rfc9000.pdf' } })
    fireEvent.submit(input.closest('form')!)
    expect(onUrl).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain(
      'Paste a full http(s) link to a PDF or Markdown file.',
    )
  })

  it('routes a picked XML file to onDraftXml, not onFile', () => {
    const onFile = vi.fn()
    const onDraftXml = vi.fn()
    render(<OpenPdf {...props} onFile={onFile} onDraftXml={onDraftXml} />)
    const xml = new File(['<rfc/>'], 'draft-x-04.xml', { type: 'text/xml' })
    fireEvent.change(screen.getByLabelText('Internet-Draft XML'), {
      target: { files: [xml] },
    })
    expect(onDraftXml).toHaveBeenCalledWith(xml)
    expect(onFile).not.toHaveBeenCalled()
  })

  it('routes a dropped XML file to onDraftXml', () => {
    const onFile = vi.fn()
    const onDraftXml = vi.fn()
    const { container } = render(
      <OpenPdf {...props} onFile={onFile} onDraftXml={onDraftXml} />,
    )
    const xml = new File(['<rfc/>'], 'draft-x-04.xml')
    fireEvent.drop(container.firstElementChild!, {
      dataTransfer: { files: [xml] },
    })
    expect(onDraftXml).toHaveBeenCalledWith(xml)
    expect(onFile).not.toHaveBeenCalled()
  })

  it('lists the interrupted document first under Continue a review, reopened only on a tap', () => {
    const onResumeInterrupted = vi.fn()
    const onForgetInterrupted = vi.fn()
    const onFile = vi.fn()
    const resumable = {
      documentId: 'a'.repeat(64),
      name: 'thesis.pdf',
      page: 12,
      openedAt: '2026-11-07T09:41:00.000Z',
    }
    render(
      <OpenPdf
        {...props}
        onFile={onFile}
        recentDocuments={[
          {
            id: 'a'.repeat(64),
            name: 'thesis.pdf',
            kind: 'pdf',
            lastAnnotatedAt: '2026-11-07T09:00:00.000Z',
            count: 3,
            stored: true,
          },
          {
            id: 'b'.repeat(64),
            name: 'other.pdf',
            kind: 'pdf',
            lastAnnotatedAt: '2026-11-06T09:00:00.000Z',
            count: 1,
            stored: false,
          },
        ]}
        interrupted={resumable}
        onResumeInterrupted={onResumeInterrupted}
        onForgetInterrupted={onForgetInterrupted}
      />,
    )
    const section = screen.getByRole('region', { name: 'Continue a review' })
    const rows = within(section).getAllByRole('listitem')
    // One feature: the interrupted document is the first row, not a second
    // entry for the same file.
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('at page 12')
    expect(rows[0].textContent).toContain('2026-11-07 09:41 UTC')
    expect(rows[1].textContent).toContain('other.pdf')
    expect(onResumeInterrupted).not.toHaveBeenCalled()
    fireEvent.click(within(rows[0]).getByText('Resume thesis.pdf'))
    expect(onResumeInterrupted).toHaveBeenCalledWith(resumable)
    fireEvent.click(
      within(rows[0]).getByRole('button', { name: 'Forget its copy' }),
    )
    expect(onForgetInterrupted).toHaveBeenCalledWith(resumable)
    expect(onFile).not.toHaveBeenCalled()
  })

  it('shows Continue a review for an interrupted document without notes', () => {
    render(
      <OpenPdf
        {...props}
        recentDocuments={[]}
        interrupted={{
          documentId: 'c'.repeat(64),
          name: 'draft.md',
          page: null,
          openedAt: '2026-11-07T09:41:00.000Z',
        }}
        onResumeInterrupted={vi.fn()}
      />,
    )
    const section = screen.getByRole('region', { name: 'Continue a review' })
    expect(section.textContent).toContain('Resume draft.md')
    expect(section.textContent).not.toContain('at page')
  })

  it('shows whether storage is persistent and how much is used', () => {
    const status = {
      usage: 1_234_567,
      quota: 10e9,
      checkedAt: '2026-11-08T01:02:00.000Z',
    }
    const { rerender } = render(
      <OpenPdf
        {...props}
        storage={{ ...status, persistence: 'granted', requested: true }}
      />,
    )
    expect(document.querySelector('.open-pdf-storage')?.textContent).toBe(
      "Storage: persistent (asked 2026-11-08 01:02 UTC). This browser has marked VoxNote's data as persistent, so it should not evict it to free space. Using 1.2 MB of about 10.0 GB.",
    )
    rerender(
      <OpenPdf
        {...props}
        storage={{ ...status, persistence: 'denied', requested: true }}
      />,
    )
    const denied = screen.getByRole('note').textContent
    expect(denied).toContain('persistence refused (asked 2026-11-08 01:02 UTC)')
    expect(denied).toContain('after seven days')
    expect(denied).toContain('Home Screen')
    rerender(
      <OpenPdf
        {...props}
        storage={{
          ...status,
          usage: null,
          quota: null,
          persistence: 'unavailable',
          requested: true,
        }}
      />,
    )
    expect(screen.getByRole('note').textContent).toContain(
      'offers no way to request persistent storage',
    )
    expect(screen.getByRole('note').textContent).toContain('Usage unknown')
  })
})
