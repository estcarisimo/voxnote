import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from 'react'
import { isDraftXmlFile, parseHttpUrl } from '../core/remotePdf'
import { formatBytes, type StorageStatus } from '../core/storagePersistence'
import { loadAnalytics } from './analytics'
import { GitHubLink, REPOSITORY_URL } from './GitHubLink'
import './OpenPdf.css'

/** A document kept on this device that was open when the page went away. */
export interface Resumable {
  documentId: string
  name: string
  /** The PDF page that was in view; null for Markdown. */
  page: number | null
  /** UTC ISO 8601, when the session was last recorded. */
  openedAt: string
}

interface OpenPdfProps {
  onFile: (file: File) => void
  /** Offered as one tap to reopen; never reopened without that tap. */
  resumable?: Resumable | null
  onResume?: (target: Resumable) => void
  /** Drops the kept copy and the session; annotations stay. */
  onForget?: (target: Resumable) => void
  /** Whether the browser may evict local data, and how much is used. */
  storage?: StorageStatus | null
  /** A PDF or Markdown file to download from that URL, straight from the browser. */
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

/** Whether local data is safe from eviction, and how much there is. */
function StorageLine({ status }: { status: StorageStatus }) {
  const asked = status.requested
    ? ` (asked ${status.checkedAt.slice(0, 10)} ${status.checkedAt.slice(11, 16)} UTC)`
    : ''
  const mode =
    status.persistence === 'granted'
      ? `Storage: persistent${asked}. This browser will not delete VoxNote's data on its own.`
      : status.persistence === 'denied'
        ? `Storage: best-effort${status.requested ? `, persistence refused${asked}` : ''}. The browser may delete VoxNote's data to free space; Safari deletes it after seven days of use without opening VoxNote, unless VoxNote is added to the Home Screen.`
        : "Storage: this browser offers no way to request persistent storage, so it may delete VoxNote's data; Safari does after seven days of use without opening VoxNote, unless VoxNote is added to the Home Screen."
  const usage =
    status.usage !== null && status.quota !== null
      ? ` Using ${formatBytes(status.usage)} of about ${formatBytes(status.quota)}.`
      : ' Usage unknown: this browser gives no estimate.'
  return (
    <p
      className={`open-pdf-storage open-pdf-storage--${status.persistence}`}
      role={status.persistence === 'granted' ? undefined : 'note'}
    >
      {mode}
      {usage}
    </p>
  )
}

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

/**
 * Landing view: pick a PDF or a Markdown file with the file dialog, or drop
 * one onto the page.
 */
export function OpenPdf({
  onFile,
  resumable = null,
  onResume,
  onForget,
  storage = null,
  onUrl,
  onDraftXml,
  error,
}: OpenPdfProps) {
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
      setUrlError('Paste a full http(s) link to a PDF or Markdown file.')
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
          Review a PDF or a Markdown document by highlighting, commenting and
          suggesting, by voice, without ever editing it.
        </p>

        {resumable && onResume && (
          <section className="open-pdf-resume" aria-label="Resume">
            <button
              type="button"
              className="open-pdf-button"
              onClick={() => onResume(resumable)}
            >
              Resume {resumable.name}
            </button>
            <p className="open-pdf-hint">
              Open when this page last closed
              {resumable.page !== null ? `, at page ${resumable.page}` : ''} (
              {resumable.openedAt.slice(0, 10)}{' '}
              {resumable.openedAt.slice(11, 16)} UTC). Kept in this browser.
              {onForget && (
                <>
                  {' '}
                  <button
                    type="button"
                    className="open-pdf-forget"
                    onClick={() => onForget(resumable)}
                  >
                    Forget it
                  </button>
                </>
              )}
            </p>
          </section>
        )}

        <div className="open-pdf-action">
          <button
            type="button"
            className="open-pdf-button"
            onClick={() => inputRef.current?.click()}
          >
            Open a document
          </button>
          <p className="open-pdf-hint">
            A PDF or a Markdown file (.md); or drop one anywhere on this page
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf,text/markdown,.md,.markdown"
            hidden
            onChange={(e) => accept(e.target.files)}
          />
          {error && (
            <p role="alert" className="open-pdf-error">
              {error}
            </p>
          )}
        </div>

        <form className="open-pdf-url" onSubmit={submitUrl}>
          <label htmlFor="open-pdf-url">Or open from a link</label>
          <div className="open-pdf-url-row">
            <input
              id="open-pdf-url"
              type="url"
              inputMode="url"
              placeholder="https://example.org/paper.pdf"
              value={urlText}
              onChange={(e) => setUrlText(e.target.value)}
            />
            <button type="submit">Open</button>
          </div>
          <p className="open-pdf-hint">
            A PDF or a Markdown file, downloaded by your browser from that site,
            which must allow it (CORS).
          </p>
          {urlError && (
            <p role="alert" className="open-pdf-error">
              {urlError}
            </p>
          )}
        </form>

        <p className="open-pdf-converters">
          Reviewing an IETF Internet-Draft? Drop its <code>.xml</code> or{' '}
          <button type="button" onClick={() => xmlInputRef.current?.click()}>
            pick it
          </button>
          : after you confirm, the IETF's author tools compile it into a PDF.
          <input
            ref={xmlInputRef}
            type="file"
            accept="text/xml,application/xml,.xml"
            hidden
            aria-label="Internet-Draft XML"
            onChange={(e) => accept(e.target.files)}
          />
        </p>

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
              Propose how a passage should read. The document stays as it is.
            </span>
          </li>
        </ul>

        <p className="open-pdf-privacy">
          Your documents, notes and recordings stay in this browser; audio goes
          out only when you confirm a transcription with your own provider key,
          and a file goes to a converter only when you confirm it in a dialog
          that names the service. That key lives only in this browser, client
          side: there is no VoxNote server. Nothing is published. Visits are
          counted with Google Analytics for statistical purposes, without
          cookies.
        </p>

        {storage && <StorageLine status={storage} />}

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
