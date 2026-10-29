import { useEffect, useRef, useState } from 'react'
import { isNote, type Annotation, type Note } from '../core/annotations'
import { formatDuration } from '../core/recording'
import './AnnotationList.css'

interface AnnotationListProps {
  annotations: readonly Annotation[]
  selectedId: string | null
  onSelect: (annotation: Annotation) => void
  onDelete: (annotation: Annotation) => void
  /** Rejecting keeps the editor open with the error shown. */
  onUpdateBody: (note: Note, body: string) => Promise<void>
  onLoadAudio: (note: Note) => Promise<Blob | null>
  /** Consent-gated transcription of a stored voice note; rejects on failure. */
  onTranscribe: (note: Note) => Promise<void>
}

/** The document's annotations: jump to one, edit a comment, or delete it. */
export function AnnotationList({
  annotations,
  selectedId,
  onSelect,
  onDelete,
  onUpdateBody,
  onLoadAudio,
  onTranscribe,
}: AnnotationListProps) {
  if (annotations.length === 0) {
    return (
      <aside className="annotation-list" aria-label="Annotations">
        <p className="annotation-list-empty">
          No annotations yet. Select text, or switch to the region tool and drag
          over a figure, then choose Highlight, Comment, Voice or Suggest.
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
            {isNote(a) ? (
              <NoteItem
                note={a}
                onSelect={onSelect}
                onDelete={onDelete}
                onUpdateBody={onUpdateBody}
                onLoadAudio={onLoadAudio}
                onTranscribe={onTranscribe}
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

function NoteItem({
  note: c,
  onSelect,
  onDelete,
  onUpdateBody,
  onLoadAudio,
  onTranscribe,
}: {
  note: Note
  onSelect: (a: Annotation) => void
  onDelete: (a: Annotation) => void
  onUpdateBody: (note: Note, body: string) => Promise<void>
  onLoadAudio: (note: Note) => Promise<Blob | null>
  onTranscribe: (note: Note) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [transcribeError, setTranscribeError] = useState<string | null>(null)

  async function transcribe() {
    setTranscribing(true)
    setTranscribeError(null)
    try {
      await onTranscribe(c)
    } catch (err: unknown) {
      setTranscribeError(err instanceof Error ? err.message : String(err))
    } finally {
      setTranscribing(false)
    }
  }
  return (
    <div className="annotation-list-comment">
      <button
        type="button"
        className="annotation-list-item"
        onClick={() => onSelect(c)}
      >
        <span className="annotation-list-page">
          p. {c.anchor.page} · {c.kind}
          {c.voice && ` · 🎤 ${formatDuration(c.voice.durationMs)}`}
        </span>
        {c.kind === 'suggestion' ? (
          <del className="annotation-list-original">{c.original}</del>
        ) : (
          <span className="annotation-list-quote">{anchorLabel(c)}</span>
        )}
        {!editing && (
          <span className="annotation-list-text">
            {c.body.trim() === '' ? (
              <em>Voice note, not transcribed yet</em>
            ) : c.kind === 'suggestion' ? (
              <ins className="annotation-list-proposed">{c.body}</ins>
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
          {transcribeError && (
            <p role="alert" className="annotation-list-error">
              {transcribeError}
            </p>
          )}
          {c.voice && <AudioPlayer comment={c} onLoadAudio={onLoadAudio} />}
          {c.voice && !c.voice.transcript && (
            <button
              type="button"
              onClick={() => void transcribe()}
              disabled={transcribing}
            >
              {transcribing ? 'Transcribing…' : 'Transcribe…'}
            </button>
          )}
          <button type="button" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button
            type="button"
            className="annotation-list-delete"
            aria-label={`Delete ${c.kind} on page ${c.anchor.page}`}
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
  comment: Note
  onSave: (body: string) => Promise<void>
  onCancel: () => void
}) {
  const [body, setBody] = useState(comment.body)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const unchanged =
    comment.kind === 'suggestion' && body.trim() === comment.original.trim()
  const canSave =
    !saving && !unchanged && (body.trim() !== '' || comment.voice !== undefined)

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
        aria-label={
          comment.kind === 'suggestion' ? 'Edit replacement' : 'Edit comment'
        }
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
  comment: Note
  onLoadAudio: (note: Note) => Promise<Blob | null>
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!url) return
    return () => URL.revokeObjectURL(url)
  }, [url])

  async function load() {
    try {
      const blob = await onLoadAudio(comment)
      if (!blob) throw new Error('The recording is missing from local storage')
      // The item may be gone by now (deleted while loading): don't create a
      // URL nobody will revoke.
      if (mounted.current) setUrl(URL.createObjectURL(blob))
    } catch (err: unknown) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : String(err))
      }
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
