import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from 'react'
import { isDraftXmlFile, parseHttpUrl } from '../core/remotePdf'
import { loadAnalytics } from './analytics'
import { GitHubLink, REPOSITORY_URL } from './GitHubLink'
import './OpenPdf.css'

interface OpenPdfProps {
  onFile: (file: File) => void
  /** A PDF to download from that URL, straight from the browser. */
  onUrl: (url: URL) => void
  /** An Internet-Draft's XML source, to compile into a PDF after consent. */
  onDraftXml: (file: File) => void
  error: string | null
}

const LICENSE_URL = `${REPOSITORY_URL}/blob/main/LICENSE`

/**
 * Where each provider hands out API keys. Static text links only: nothing
 * here is fetched, so the landing makes no request to any of these hosts.
 */
const PROVIDER_KEY_PAGES = {
  deepgram: 'https://console.deepgram.com/',
  groq: 'https://console.groq.com/keys',
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://platform.claude.com/settings/keys',
  xai: 'https://console.x.ai/team/default/api-keys',
} as const

function KeyLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

// Served from public/, so it resolves under the production subpath too.
const ICON_URL = `${import.meta.env.BASE_URL}icon.svg`

/**
 * True when the page runs as an installed app (home screen, dock), where an
 * install hint would be noise. A browser without `matchMedia` (jsdom) counts
 * as not installed, so the hint shows.
 */
function isStandalone(): boolean {
  if (typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(display-mode: standalone)').matches
}

/** Landing view: pick a PDF with the file dialog or drop one onto the page. */
export function OpenPdf({ onFile, onUrl, onDraftXml, error }: OpenPdfProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const xmlInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [urlText, setUrlText] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [standalone] = useState(isStandalone)

  // Visit counting runs from the landing view only; a no-op unless the
  // build set VITE_GA_MEASUREMENT_ID (see analytics.ts).
  useEffect(() => {
    loadAnalytics(import.meta.env.VITE_GA_MEASUREMENT_ID)
  }, [])

  /** A dropped or picked XML file is a draft to compile; anything else, a PDF. */
  function accept(fileList: FileList | null) {
    const file = fileList?.[0]
    if (!file) return
    if (isDraftXmlFile(file)) onDraftXml(file)
    else onFile(file)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    accept(event.dataTransfer.files)
  }

  function submitUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const url = parseHttpUrl(urlText)
    if (!url) {
      setUrlError('Paste a full http(s) link to a PDF.')
      return
    }
    setUrlError(null)
    onUrl(url)
  }

  return (
    <div
      className={`open-pdf${dragging ? ' open-pdf--dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <div className="open-pdf-corner">
        <GitHubLink />
      </div>
      <main className="open-pdf-main">
        <img
          className="open-pdf-icon"
          src={ICON_URL}
          alt=""
          width={96}
          height={96}
        />
        <h1>VoxNote</h1>
        <p className="open-pdf-tagline">Your voice, in the margins.</p>
        <p className="open-pdf-lead">
          Review a PDF by highlighting, commenting and suggesting, by voice,
          without ever editing it.
        </p>

        <div className="open-pdf-action">
          <button
            type="button"
            className="open-pdf-button"
            onClick={() => inputRef.current?.click()}
          >
            Open a PDF
          </button>
          <p className="open-pdf-hint">or drop one anywhere on this page</p>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => accept(e.target.files)}
          />
          {error && (
            <p role="alert" className="open-pdf-error">
              {error}
            </p>
          )}
        </div>

        <div className="open-pdf-remote">
          <form className="open-pdf-url" onSubmit={submitUrl}>
            <label htmlFor="open-pdf-url">Or open a PDF from a link</label>
            <div className="open-pdf-url-row">
              <input
                id="open-pdf-url"
                type="url"
                inputMode="url"
                placeholder="https://www.rfc-editor.org/rfc/rfc9000.pdf"
                value={urlText}
                onChange={(e) => setUrlText(e.target.value)}
              />
              <button type="submit">Open</button>
            </div>
            <p className="open-pdf-hint">
              Downloaded by your browser from that site, which must allow it
              (CORS). RFCs from rfc-editor.org work.
            </p>
            {urlError && (
              <p role="alert" className="open-pdf-error">
                {urlError}
              </p>
            )}
          </form>
          <div className="open-pdf-draft">
            <button type="button" onClick={() => xmlInputRef.current?.click()}>
              Open an Internet-Draft (XML)
            </button>
            <p className="open-pdf-hint">
              The XML is compiled into a PDF by the IETF's author tools, after
              you confirm.
            </p>
            <input
              ref={xmlInputRef}
              type="file"
              accept="text/xml,application/xml,.xml"
              hidden
              aria-label="Internet-Draft XML"
              onChange={(e) => accept(e.target.files)}
            />
          </div>
        </div>

        <ul className="open-pdf-features" aria-label="What you can do">
          <li>
            <strong>Highlight</strong>
            <span>
              Select a passage, or draw a region over a figure or equation.
            </span>
          </li>
          <li>
            <strong>Comment by voice</strong>
            <span>
              Record a note next to the passage. Type it if you prefer.
            </span>
          </li>
          <li>
            <strong>Suggest a replacement</strong>
            <span>
              Propose how a passage should read. The PDF stays as it is.
            </span>
          </li>
        </ul>

        <p className="open-pdf-privacy">
          Your PDF, notes and recordings stay in this browser; audio goes out
          only when you confirm a transcription with your own provider key, and
          an Internet-Draft's XML only when you confirm sending it to the IETF's
          author tools. That key lives only in this browser, client side: there
          is no VoxNote server. Nothing is published. Visits are counted with
          Google Analytics for statistical purposes, without cookies.
        </p>

        <section className="open-pdf-start" aria-labelledby="get-started">
          <h2 id="get-started">Get started</h2>
          <ol>
            <li>
              Get an API key from a speech-to-text provider:{' '}
              <KeyLink href={PROVIDER_KEY_PAGES.deepgram}>Deepgram</KeyLink>,{' '}
              <KeyLink href={PROVIDER_KEY_PAGES.groq}>Groq</KeyLink> or{' '}
              <KeyLink href={PROVIDER_KEY_PAGES.openai}>OpenAI</KeyLink>.
            </li>
            <li>
              Optional, to polish notes:{' '}
              <KeyLink href={PROVIDER_KEY_PAGES.anthropic}>Anthropic</KeyLink>,{' '}
              <KeyLink href={PROVIDER_KEY_PAGES.openai}>OpenAI</KeyLink> or{' '}
              <KeyLink href={PROVIDER_KEY_PAGES.xai}>xAI</KeyLink>.
            </li>
            <li>
              Paste it in <strong>AI keys</strong>. It stays encrypted in your
              browser.
            </li>
          </ol>
          <p>
            VoxNote is not affiliated with any of these companies. You pay them
            directly under your own account, and audio goes from your device to
            the provider you chose. Several providers offer free credit to
            start; check their current pricing.
          </p>
        </section>

        {!standalone && (
          <p className="open-pdf-install">
            Install it from your browser: tap Share, then Add to Home Screen.
          </p>
        )}
      </main>

      <footer className="open-pdf-footer">
        <span>Open source, MIT</span>
        <nav aria-label="Project links">
          <a href={LICENSE_URL} target="_blank" rel="noreferrer">
            License
          </a>
        </nav>
      </footer>
    </div>
  )
}
