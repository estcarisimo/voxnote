import type { DocumentSummary } from '../core/store'
import './RecentDocuments.css'

export interface RecentDocument extends DocumentSummary {
  /** True when this browser keeps the file's bytes and can reopen it alone. */
  stored: boolean
}

interface RecentDocumentsProps {
  documents: readonly RecentDocument[]
  /** Reopens from stored bytes, or asks for the file. */
  onResume: (document: RecentDocument) => void
}

/**
 * The documents with notes in this browser, most recent first, so a
 * reviewer knows which file to open to continue. Shows nothing when there
 * are none.
 */
export function RecentDocuments({ documents, onResume }: RecentDocumentsProps) {
  if (documents.length === 0) return null
  return (
    <section className="recent-documents" aria-labelledby="recent-documents">
      <h2 id="recent-documents">Continue a review</h2>
      <ul>
        {documents.map((d) => {
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
        Your notes are kept in this browser. VoxNote asks for the file again and
        checks it is the same one by its content; on another device, open the
        file and use <strong>Import notes…</strong> with its{' '}
        <code>.voxnote.json</code>.
      </p>
    </section>
  )
}

/** "2026-11-07 18:04", from an ISO 8601 UTC timestamp. */
function formatUtc(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ')
}
