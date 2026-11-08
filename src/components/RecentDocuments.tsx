import type { DocumentSummary } from '../core/store'
import './RecentDocuments.css'

export interface RecentDocument extends DocumentSummary {
  /** True when this browser keeps the file's bytes and can reopen it alone. */
  stored: boolean
}

/** A document kept on this device that was open when the page went away. */
export interface Resumable {
  documentId: string
  name: string
  /** The PDF page that was in view; null for Markdown. */
  page: number | null
  /** UTC ISO 8601, when the session was last recorded. */
  openedAt: string
}

interface RecentDocumentsProps {
  documents: readonly RecentDocument[]
  /** Reopens from stored bytes, or asks for the file. */
  onResume: (document: RecentDocument) => void
  /**
   * The document left open by a crash or a killed tab: listed first, with
   * its page, and reopened only on a tap.
   */
  interrupted?: Resumable | null
  onResumeInterrupted?: (target: Resumable) => void
  /** Drops its kept copy and the session; its notes stay. */
  onForgetInterrupted?: (target: Resumable) => void
}

/**
 * Continue a review: first the document that was open when the page last
 * went away, if any, then the documents with notes in this browser, most
 * recent first. Shows nothing when there are none.
 */
export function RecentDocuments({
  documents,
  onResume,
  interrupted = null,
  onResumeInterrupted,
  onForgetInterrupted,
}: RecentDocumentsProps) {
  const left = interrupted && onResumeInterrupted ? interrupted : null
  const others = left
    ? documents.filter((d) => d.id !== left.documentId)
    : documents
  if (others.length === 0 && !left) return null
  return (
    <section className="recent-documents" aria-labelledby="recent-documents">
      <h2 id="recent-documents">Continue a review</h2>
      <ul>
        {left && onResumeInterrupted && (
          <li className="recent-documents-interrupted">
            <button
              type="button"
              onClick={() => onResumeInterrupted(left)}
              title={`SHA-256 ${left.documentId}`}
            >
              <span className="recent-documents-name">{left.name}</span>
              <span className="recent-documents-meta">
                Open when this page last closed
                {left.page !== null ? `, at page ${left.page}` : ''} ·{' '}
                {formatUtc(left.openedAt)} UTC · unsaved drafts come back too
              </span>
              <span className="recent-documents-action">
                Resume {left.name}
              </span>
            </button>
            {onForgetInterrupted && (
              <button
                type="button"
                className="recent-documents-forget"
                onClick={() => onForgetInterrupted(left)}
              >
                Forget its copy
              </button>
            )}
          </li>
        )}
        {others.map((d) => {
          const name = d.name ?? `Unnamed document ${d.id.slice(0, 8)}…`
          return (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => onResume(d)}
                title={`SHA-256 ${d.id}`}
              >
                <span className="recent-documents-name">{name}</span>
                <span className="recent-documents-meta">
                  {d.count} {d.count === 1 ? 'annotation' : 'annotations'} ·
                  notes saved {formatUtc(d.lastAnnotatedAt)} UTC
                </span>
                <span className="recent-documents-action">
                  {d.stored ? 'Reopen' : 'Choose file…'}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <p className="recent-documents-hint">
        Your notes, and a copy of each document you open, are kept in this
        browser. A document without a kept copy asks for its file and checks it
        is the same one by its content; on another device, open the file and use{' '}
        <strong>Import notes…</strong> with its <code>.voxnote.json</code>.
      </p>
    </section>
  )
}

/** "2026-11-07 18:04", from an ISO 8601 UTC timestamp. */
function formatUtc(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ')
}
