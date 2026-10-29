import { useEffect, useRef, useState, type DragEvent } from 'react'
import { loadAnalytics } from './analytics'
import './OpenPdf.css'

interface OpenPdfProps {
  onFile: (file: File) => void
  error: string | null
}

const REPOSITORY_URL = 'https://github.com/estcarisimo/voxnote'
const ROADMAP_URL = `${REPOSITORY_URL}/blob/main/ROADMAP.md`
const LICENSE_URL = `${REPOSITORY_URL}/blob/main/LICENSE`

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
export function OpenPdf({ onFile, error }: OpenPdfProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [standalone] = useState(isStandalone)

  // Visit counting runs from the landing view only; a no-op unless the
  // build set VITE_GA_MEASUREMENT_ID (see analytics.ts).
  useEffect(() => {
    loadAnalytics(import.meta.env.VITE_GA_MEASUREMENT_ID)
  }, [])

  function accept(fileList: FileList | null) {
    const file = fileList?.[0]
    if (!file) return
    onFile(file)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    accept(event.dataTransfer.files)
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
          Your PDF, notes and recordings never leave this browser. Audio is sent
          only when you confirm a transcription with your own provider key.
          Nothing is published. Visits are counted with Google Analytics,
          without cookies.
        </p>

        {!standalone && (
          <p className="open-pdf-install">
            Install it on iPad: open in Safari, tap Share, then Add to Home
            Screen.
          </p>
        )}
      </main>

      <footer className="open-pdf-footer">
        <span>Open source, MIT</span>
        <nav aria-label="Project links">
          <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
            Repository
          </a>
          <a href={ROADMAP_URL} target="_blank" rel="noreferrer">
            Roadmap
          </a>
          <a href={LICENSE_URL} target="_blank" rel="noreferrer">
            License
          </a>
        </nav>
      </footer>
    </div>
  )
}
