import { useEffect, useId, useRef, useState } from 'react'
import {
  isNote,
  type Annotation,
  type AnnotationKind,
  type Note,
  type Visibility,
} from '../core/annotations'
import { formatDuration } from '../core/recording'
import {
  EMPTY_FILTER,
  filterAnnotations,
  groupAnnotations,
  isFilterActive,
  isGroupBy,
  KIND_LABELS,
  VISIBILITY_LABELS,
  type GroupBy,
  type ReviewFilter,
} from '../core/review'
import './AnnotationList.css'

interface AnnotationListProps {
  annotations: readonly Annotation[]
  selectedId: string | null
  onSelect: (annotation: Annotation) => void
  onDelete: (annotation: Annotation) => void
  /** Rejecting keeps the editor open with the error shown. */
  onUpdateBody: (note: Note, body: string) => Promise<void>
  /** Rejecting leaves the toggle as it was, with the error shown. */
  onUpdateVisibility: (
    annotation: Annotation,
    visibility: Visibility,
  ) => Promise<void>
  onLoadAudio: (note: Note) => Promise<Blob | null>
  /** Consent-gated transcription of a stored voice note; rejects on failure. */
  onTranscribe: (note: Note) => Promise<void>
}

const KIND_CHIPS: readonly AnnotationKind[] = [
  'suggestion',
  'comment',
  'highlight',
]

/**
 * The review sidebar: the document's annotations grouped by kind, visibility
 * or page, narrowed by a filter, each one a tap away from its passage.
 */
export function AnnotationList({
  annotations,
  selectedId,
  onSelect,
  onDelete,
  onUpdateBody,
  onUpdateVisibility,
  onLoadAudio,
  onTranscribe,
}: AnnotationListProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>('kind')
  const [filter, setFilter] = useState<ReviewFilter>(EMPTY_FILTER)

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

  const shown = filterAnnotations(annotations, filter)
  const groups = groupAnnotations(shown, groupBy)
  const active = isFilterActive(filter)

  return (
    <aside className="annotation-list" aria-label="Annotations">
      <ReviewToolbar
        filter={filter}
        groupBy={groupBy}
        shown={shown.length}
        total={annotations.length}
        onFilter={setFilter}
        onGroupBy={setGroupBy}
      />
      {shown.length === 0 ? (
        <p className="annotation-list-empty">
          No annotations match the filter.{' '}
          <button
            type="button"
            className="annotation-list-link"
            onClick={() => setFilter(EMPTY_FILTER)}
          >
            Clear filter
          </button>
        </p>
      ) : (
        groups.map((group) => (
          <ReviewGroupSection
            key={group.key}
            label={group.label}
            // A single-group listing needs no heading.
            headed={groups.length > 1 || active || groupBy === 'page'}
            annotations={group.annotations}
            selectedId={selectedId}
            onSelect={onSelect}
            onDelete={onDelete}
            onUpdateBody={onUpdateBody}
            onUpdateVisibility={onUpdateVisibility}
            onLoadAudio={onLoadAudio}
            onTranscribe={onTranscribe}
          />
        ))
      )}
    </aside>
  )
}

function ReviewToolbar({
  filter,
  groupBy,
  shown,
  total,
  onFilter,
  onGroupBy,
}: {
  filter: ReviewFilter
  groupBy: GroupBy
  shown: number
  total: number
  onFilter: (filter: ReviewFilter) => void
  onGroupBy: (groupBy: GroupBy) => void
}) {
  const groupId = useId()
  const active = isFilterActive(filter)

  function toggleKind(kind: AnnotationKind) {
    const kinds = filter.kinds.includes(kind)
      ? filter.kinds.filter((k) => k !== kind)
      : [...filter.kinds, kind]
    onFilter({ ...filter, kinds })
  }

  function toggleVisibility(visibility: Visibility) {
    onFilter({
      ...filter,
      visibility: filter.visibility === visibility ? null : visibility,
    })
  }

  return (
    <div className="annotation-list-toolbar">
      <input
        type="search"
        className="annotation-list-search"
        aria-label="Search annotations"
        placeholder="Search quotes, notes, transcripts"
        value={filter.query}
        onChange={(e) => onFilter({ ...filter, query: e.target.value })}
      />
      <div
        className="annotation-list-chips"
        role="group"
        aria-label="Filter by kind"
      >
        {KIND_CHIPS.map((kind) => (
          <button
            key={kind}
            type="button"
            className="annotation-list-chip"
            aria-pressed={filter.kinds.includes(kind)}
            onClick={() => toggleKind(kind)}
          >
            {KIND_LABELS[kind]}
          </button>
        ))}
      </div>
      <div
        className="annotation-list-chips"
        role="group"
        aria-label="Filter by visibility"
      >
        {(['author-facing', 'private'] as const).map((visibility) => (
          <button
            key={visibility}
            type="button"
            className="annotation-list-chip"
            aria-pressed={filter.visibility === visibility}
            onClick={() => toggleVisibility(visibility)}
          >
            {VISIBILITY_LABELS[visibility]}
          </button>
        ))}
        <button
          type="button"
          className="annotation-list-chip"
          aria-pressed={filter.untranscribedOnly}
          onClick={() =>
            onFilter({
              ...filter,
              untranscribedOnly: !filter.untranscribedOnly,
            })
          }
        >
          🎤 Untranscribed
        </button>
      </div>
      <div className="annotation-list-meta">
        <label htmlFor={groupId}>Group by</label>
        <select
          id={groupId}
          value={groupBy}
          onChange={(e) => {
            const value: unknown = e.target.value
            if (!isGroupBy(value)) {
              throw new Error(`Unknown grouping "${String(value)}"`)
            }
            onGroupBy(value)
          }}
        >
          <option value="kind">kind</option>
          <option value="visibility">visibility</option>
          <option value="page">page</option>
        </select>
        <span className="annotation-list-count" aria-live="polite">
          {active ? `${shown} of ${total}` : `${total}`}
        </span>
        {active && (
          <button
            type="button"
            className="annotation-list-link"
            onClick={() => onFilter(EMPTY_FILTER)}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  )
}

function ReviewGroupSection({
  label,
  headed,
  annotations,
  selectedId,
  onSelect,
  onDelete,
  onUpdateBody,
  onUpdateVisibility,
  onLoadAudio,
  onTranscribe,
}: {
  label: string
  headed: boolean
  annotations: readonly Annotation[]
  selectedId: string | null
  onSelect: (annotation: Annotation) => void
  onDelete: (annotation: Annotation) => void
  onUpdateBody: (note: Note, body: string) => Promise<void>
  onUpdateVisibility: (a: Annotation, visibility: Visibility) => Promise<void>
  onLoadAudio: (note: Note) => Promise<Blob | null>
  onTranscribe: (note: Note) => Promise<void>
}) {
  const headingId = useId()
  return (
    <section
      className="annotation-list-group"
      aria-labelledby={headed ? headingId : undefined}
      aria-label={headed ? undefined : label}
    >
      {headed && (
        <h3 id={headingId} className="annotation-list-heading">
          {label}
          <span className="annotation-list-count" aria-hidden="true">
            {annotations.length}
          </span>
        </h3>
      )}
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
                onUpdateVisibility={onUpdateVisibility}
                onLoadAudio={onLoadAudio}
                onTranscribe={onTranscribe}
              />
            ) : (
              <HighlightItem
                annotation={a}
                onSelect={onSelect}
                onDelete={onDelete}
                onUpdateVisibility={onUpdateVisibility}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Flips an annotation between private and for the author. The change is
 * written first; the label follows the stored value, never a guess.
 */
function VisibilityToggle({
  annotation: a,
  onUpdateVisibility,
}: {
  annotation: Annotation
  onUpdateVisibility: (a: Annotation, visibility: Visibility) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const next: Visibility =
    a.visibility === 'private' ? 'author-facing' : 'private'

  async function toggle() {
    setBusy(true)
    setError(null)
    try {
      await onUpdateVisibility(a, next)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="annotation-list-visibility"
        data-visibility={a.visibility}
        // The visible text is the accessible name and states the stored
        // value; the title says what a tap does. Exports do not filter on
        // visibility yet, so "private" is a label, not a guarantee.
        title={
          a.visibility === 'private'
            ? 'A note to yourself; exports still include it. Tap to mark it for the author.'
            : 'Meant for the author. Tap to mark it as a note to yourself.'
        }
        disabled={busy}
        onClick={() => void toggle()}
      >
        {a.visibility === 'private' ? '🔒 Private' : '✉ For author'}
      </button>
      {error && (
        <p role="alert" className="annotation-list-error">
          {error}
        </p>
      )}
    </>
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
  onUpdateVisibility,
}: {
  annotation: Annotation
  onSelect: (a: Annotation) => void
  onDelete: (a: Annotation) => void
  onUpdateVisibility: (a: Annotation, visibility: Visibility) => Promise<void>
}) {
  return (
    <div className="annotation-list-comment">
      <button
        type="button"
        className="annotation-list-item"
        onClick={() => onSelect(a)}
      >
        <span className="annotation-list-page">p. {a.anchor.page}</span>
        <span className="annotation-list-text">{anchorLabel(a)}</span>
      </button>
      <div className="annotation-list-actions">
        <VisibilityToggle
          annotation={a}
          onUpdateVisibility={onUpdateVisibility}
        />
        <button
          type="button"
          className="annotation-list-delete"
          aria-label={`Delete highlight on page ${a.anchor.page}`}
          onClick={() => onDelete(a)}
        >
          ×
        </button>
      </div>
    </div>
  )
}

function NoteItem({
  note: c,
  onSelect,
  onDelete,
  onUpdateBody,
  onUpdateVisibility,
  onLoadAudio,
  onTranscribe,
}: {
  note: Note
  onSelect: (a: Annotation) => void
  onDelete: (a: Annotation) => void
  onUpdateBody: (note: Note, body: string) => Promise<void>
  onUpdateVisibility: (a: Annotation, visibility: Visibility) => Promise<void>
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
          <VisibilityToggle
            annotation={c}
            onUpdateVisibility={onUpdateVisibility}
          />
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
