import { useEffect, useState } from 'react'
import type { Annotation, Comment } from '../core/annotations'
import { formatDuration } from '../core/recording'
import './AnnotationList.css'

interface AnnotationListProps {
  annotations: readonly Annotation[]
  selectedId: string | null
  onSelect: (annotation: Annotation) => void
  onDelete: (annotation: Annotation) => void
  /** Rejecting keeps the editor open with the error shown. */
  onUpdateBody: (comment: Comment, body: string) => Promise<void>
  onLoadAudio: (comment: Comment) => Promise<Blob | null>
}

/** The document's annotations: jump to one, edit a comment, or delete it. */
export function AnnotationList({
  annotations,
  selectedId,
  onSelect,
  onDelete,
  onUpdateBody,
  onLoadAudio,
}: AnnotationListProps) {
  if (annotations.length === 0) {
    return (
      <aside className="annotation-list" aria-label="Annotations">
        <p className="annotation-list-empty">
          No annotations yet. Select text, or switch to the region tool and drag
          over a figure, then choose Highlight, Comment or Voice.
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
            {a.kind === 'comment' ? (
              <CommentItem
                comment={a}
                onSelect={onSelect}
                onDelete={onDelete}
                onUpdateBody={onUpdateBody}
                onLoadAudio={onLoadAudio}
              />
            ) : (
              <HighlightItem
                annotation={a}
                onSelect={onSelect}
                onDelete={onDelete}
              />
            )}
          </li>
        ))}
      </ul>
    </aside>
  )
}

function anchorLabel(a: Annotation): string {
  return a.anchor.type === 'text'
    ? a.anchor.quote
    : 'Region (figure, chart or equation)'
}

function HighlightItem({
  annotation: a,
  onSelect,
  onDelete,
}: {
  annotation: Annotation
  onSelect: (a: Annotation) => void
  onDelete: (a: Annotation) => void
}) {
  return (
    <>
      <button
        type="button"
        className="annotation-list-item"
        onClick={() => onSelect(a)}
      >
        <span className="annotation-list-page">p. {a.anchor.page}</span>
        <span className="annotation-list-text">{anchorLabel(a)}</span>
      </button>
      <button
        type="button"
        className="annotation-list-delete"
        aria-label={`Delete highlight on page ${a.anchor.page}`}
        onClick={() => onDelete(a)}
      >
        ×
      </button>
    </>
  )
}

function CommentItem({
  comment: c,
  onSelect,
  onDelete,
  onUpdateBody,
  onLoadAudio,
}: {
  comment: Comment
  onSelect: (a: Annotation) => void
  onDelete: (a: Annotation) => void
  onUpdateBody: (comment: Comment, body: string) => Promise<void>
  onLoadAudio: (comment: Comment) => Promise<Blob | null>
}) {
  const [editing, setEditing] = useState(false)
  return (
    <div className="annotation-list-comment">
      <button
        type="button"
        className="annotation-list-item"
        onClick={() => onSelect(c)}
      >
        <span className="annotation-list-page">
          p. {c.anchor.page} · comment
          {c.voice && ` · 🎤 ${formatDuration(c.voice.durationMs)}`}
        </span>
        <span className="annotation-list-quote">{anchorLabel(c)}</span>
        {!editing && (
          <span className="annotation-list-text">
            {c.body.trim() === '' ? (
              <em>Voice note, not transcribed yet</em>
            ) : (
              c.body
            )}
          </span>
        )}
      </button>
      {editing ? (
        <BodyEditor
          comment={c}
          onSave={async (body) => {
            await onUpdateBody(c, body)
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="annotation-list-actions">
          {c.voice && <AudioPlayer comment={c} onLoadAudio={onLoadAudio} />}
          <button type="button" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button
            type="button"
            className="annotation-list-delete"
            aria-label={`Delete comment on page ${c.anchor.page}`}
            onClick={() => onDelete(c)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}

function BodyEditor({
  comment,
  onSave,
  onCancel,
}: {
  comment: Comment
  onSave: (body: string) => Promise<void>
  onCancel: () => void
}) {
  const [body, setBody] = useState(comment.body)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canSave = !saving && (body.trim() !== '' || comment.voice !== undefined)

  async function save() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      await onSave(body)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <div className="annotation-list-editor">
      <textarea
        aria-label="Edit comment"
        rows={3}
        value={body}
        autoFocus
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save()
        }}
      />
      {comment.voice?.transcript && (
        <details className="annotation-list-raw">
          <summary>
            Raw transcript ({comment.voice.transcript.provider})
          </summary>
          <p>{comment.voice.transcript.raw}</p>
        </details>
      )}
      {error && (
        <p role="alert" className="annotation-list-error">
          {error}
        </p>
      )}
      <div className="annotation-list-actions">
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button
          type="button"
          className="is-primary"
          disabled={!canSave}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

/** Loads the recording on demand and plays it; nothing is fetched remotely. */
function AudioPlayer({
  comment,
  onLoadAudio,
}: {
  comment: Comment
  onLoadAudio: (comment: Comment) => Promise<Blob | null>
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!url) return
    return () => URL.revokeObjectURL(url)
  }, [url])

  async function load() {
    try {
      const blob = await onLoadAudio(comment)
      if (!blob) throw new Error('The recording is missing from local storage')
      setUrl(URL.createObjectURL(blob))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (error) {
    return (
      <p role="alert" className="annotation-list-error">
        {error}
      </p>
    )
  }
  if (url) return <audio controls autoPlay src={url} />
  return (
    <button type="button" onClick={() => void load()}>
      ▶ Play
    </button>
  )
}
