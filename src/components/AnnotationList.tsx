import type { Annotation } from '../core/annotations'
import './AnnotationList.css'

interface AnnotationListProps {
  annotations: readonly Annotation[]
  selectedId: string | null
  onSelect: (annotation: Annotation) => void
  onDelete: (annotation: Annotation) => void
}

/** Minimal list of the document's annotations: jump to one or delete it. */
export function AnnotationList({
  annotations,
  selectedId,
  onSelect,
  onDelete,
}: AnnotationListProps) {
  if (annotations.length === 0) {
    return (
      <aside className="annotation-list" aria-label="Annotations">
        <p className="annotation-list-empty">
          No highlights yet. Select text, or switch to the region tool and drag
          over a figure.
        </p>
      </aside>
    )
  }
  return (
    <aside className="annotation-list" aria-label="Annotations">
      <ul>
        {annotations.map((a) => (
          <li
            key={a.id}
            className={a.id === selectedId ? 'is-selected' : undefined}
          >
            <button
              type="button"
              className="annotation-list-item"
              onClick={() => onSelect(a)}
            >
              <span className="annotation-list-page">p. {a.anchor.page}</span>
              <span className="annotation-list-text">
                {a.anchor.type === 'text'
                  ? a.anchor.quote
                  : 'Region (figure, chart or equation)'}
              </span>
            </button>
            <button
              type="button"
              className="annotation-list-delete"
              aria-label={`Delete highlight on page ${a.anchor.page}`}
              onClick={() => onDelete(a)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
