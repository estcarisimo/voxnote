import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONSENT_DEFAULT, GTAG_SCRIPT_ATTRIBUTE } from './analytics'
import { OpenPdf } from './OpenPdf'

function pdfFile(name = 'paper.pdf') {
  return new File(['%PDF-1.4'], name, { type: 'application/pdf' })
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
    const { container } = render(<OpenPdf onFile={onFile} error={null} />)
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = pdfFile()
    fireEvent.change(input, { target: { files: [file] } })
    expect(onFile).toHaveBeenCalledTimes(1)
    expect(onFile).toHaveBeenCalledWith(file)
  })

  it('passes a dropped file to onFile and clears the dragging state', () => {
    const onFile = vi.fn()
    const { container } = render(<OpenPdf onFile={onFile} error={null} />)
    const zone = container.firstElementChild!
    fireEvent.dragOver(zone)
    expect(zone.className).toContain('open-pdf--dragging')
    const file = pdfFile()
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    expect(onFile).toHaveBeenCalledWith(file)
    expect(zone.className).not.toContain('open-pdf--dragging')
  })

  it('ignores a drop with no file', () => {
    const onFile = vi.fn()
    const { container } = render(<OpenPdf onFile={onFile} error={null} />)
    fireEvent.drop(container.firstElementChild!, {
      dataTransfer: { files: [] },
    })
    expect(onFile).not.toHaveBeenCalled()
  })

  it('shows the error as an alert', () => {
    render(<OpenPdf onFile={vi.fn()} error="Not a PDF" />)
    expect(screen.getByRole('alert').textContent).toBe('Not a PDF')
  })

  it('shows no alert without an error', () => {
    render(<OpenPdf onFile={vi.fn()} error={null} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('has one h1 and links to the repository and license in new tabs', () => {
    render(<OpenPdf onFile={vi.fn()} error={null} />)
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
    const { container } = render(<OpenPdf onFile={vi.fn()} error={null} />)
    const icon = container.querySelector<HTMLImageElement>('img.open-pdf-icon')!
    expect(icon.getAttribute('src')).toBe(`${import.meta.env.BASE_URL}icon.svg`)
  })

  it('shows the install hint when not running standalone', () => {
    stubDisplayMode(false)
    render(<OpenPdf onFile={vi.fn()} error={null} />)
    expect(screen.getByText(/Add to Home Screen/)).toBeTruthy()
    expect(window.matchMedia).toHaveBeenCalledWith('(display-mode: standalone)')
  })

  it('shows the install hint when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    render(<OpenPdf onFile={vi.fn()} error={null} />)
    expect(screen.getByText(/Add to Home Screen/)).toBeTruthy()
  })

  it('hides the install hint when running standalone', () => {
    stubDisplayMode(true)
    render(<OpenPdf onFile={vi.fn()} error={null} />)
    expect(screen.queryByText(/Add to Home Screen/)).toBeNull()
  })

  it('loads no analytics script without VITE_GA_MEASUREMENT_ID', () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', '')
    render(<OpenPdf onFile={vi.fn()} error={null} />)
    expect(
      document.querySelector(`script[${GTAG_SCRIPT_ATTRIBUTE}]`),
    ).toBeNull()
    expect(window.dataLayer).toBeUndefined()
  })

  it('loads gtag with storage denied when VITE_GA_MEASUREMENT_ID is set', () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-LANDING1')
    render(<OpenPdf onFile={vi.fn()} error={null} />)
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
    render(<OpenPdf onFile={vi.fn()} error={null} />)
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
    const { container } = render(<OpenPdf onFile={vi.fn()} error={null} />)
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
    const { container } = render(<OpenPdf onFile={vi.fn()} error={null} />)
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
    render(<OpenPdf onFile={vi.fn()} error={null} />)
    const line = screen.getByText(/Google Analytics/).textContent
    expect(line).toContain('stay in this browser')
    expect(line).toContain('key lives only in this browser, client side')
    expect(line).toContain('for statistical purposes')
  })
})
