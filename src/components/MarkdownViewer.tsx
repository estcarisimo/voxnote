import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from 'react'
import type { Annotation, BlockTextAnchor } from '../core/annotations'
import {
  BLOCK_ATTRIBUTE,
  blockTextAnchorFromRange,
  rangeForBlockAnchor,
} from '../core/blockSelection'
import type { MarkdownDocument } from '../core/markdown'
import { highlightRgb, type HighlightColor } from '../core/palette'
import type { AutoTranscribeState } from '../hooks/useTranscription'
import { useVoiceRecorder } from '../hooks/useVoiceRecorder'
import type { CleanUpFn } from './CleanUpDialog'
import { CommentComposer, type CommentDraft } from './CommentComposer'
import { MarkdownView } from './MarkdownView'
import type { NewNoteRequest } from './PdfViewer'
import { SelectionToolbar, type ToolbarPlacement } from './SelectionToolbar'
import type { TranscribeFn } from './TranscribeDialog'
import './MarkdownViewer.css'

export interface MarkdownViewerHandle {
  /** Brings the annotation's marks into view; falls back to its block. */
  scrollToAnnotation(annotation: Annotation): void
}

interface MarkdownViewerProps {
  document: MarkdownDocument
  annotations: readonly Annotation[]
  selectedId: string | null
  /** The color of the next highlight, shown as dots in the toolbar. */
  highlightColor: HighlightColor
  onHighlightColorChange: (color: HighlightColor) => void
  onCreateHighlight: (anchor: BlockTextAnchor, color: HighlightColor) => void
  /** Rejecting keeps the composer open with the error shown. */
  onCreateNote: (request: NewNoteRequest) => Promise<void>
  /** Consent-gated transcription for a fresh recording; null if unavailable. */
  transcribe: TranscribeFn | null
  /** Consent-gated clean-up of a fresh transcript; null if unavailable. */
  cleanUp?: CleanUpFn | null
  /** The document's standing consent to transcribe on Stop. */
  autoTranscribe?: AutoTranscribeState | null
  ref?: Ref<MarkdownViewerHandle>
}

const SELECTION_SETTLE_MS = 120

interface PendingAnchor {
  anchor: BlockTextAnchor
  placement: ToolbarPlacement
}

type Composer = 'typed' | 'voice' | 'suggest' | null

/**
 * Shows a rendered Markdown document and turns text selections inside one
 * top-level block into block-text anchors: a floating toolbar offers a
 * highlight, a comment (typed or dictated) or a suggestion for each. Marks
 * for stored annotations are drawn from DOM ranges over the text, so they
 * follow the width of the window.
 */
export function MarkdownViewer({
  document: markdown,
  annotations,
  selectedId,
  highlightColor,
  onHighlightColorChange,
  onCreateHighlight,
  onCreateNote,
  transcribe,
  cleanUp = null,
  autoTranscribe = null,
  ref,
}: MarkdownViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const paperRef = useRef<HTMLDivElement>(null)
  const [pending, setPending] = useState<PendingAnchor | null>(null)
  const [composer, setComposer] = useState<Composer>(null)
  const composerRef = useRef<Composer>(null)
  const recorder = useVoiceRecorder()

  useEffect(() => {
    composerRef.current = composer
  }, [composer])

  // Whatever closed the composer, the microphone and replay URL go with it.
  const { discard } = recorder
  useEffect(() => {
    if (composer === null) discard()
  }, [composer, discard])

  useImperativeHandle(ref, () => ({
    scrollToAnnotation(annotation) {
      const container = containerRef.current
      if (!container) return
      const mark = container.querySelector(
        `[data-annotation-id="${annotation.id}"]`,
      )
      const target =
        mark ??
        container.querySelector(
          `[${BLOCK_ATTRIBUTE}="${annotation.anchor.page}"]`,
        )
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    },
  }))

  // Watch the selection; when it settles inside one block, offer the
  // toolbar. While a composer is open the anchor is frozen: typing in it
  // moves the DOM selection.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const update = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (composerRef.current) return
        setPending(readSelection(paperRef.current, containerRef.current))
      }, SELECTION_SETTLE_MS)
    }
    document.addEventListener('selectionchange', update)
    document.addEventListener('pointerup', update)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('selectionchange', update)
      document.removeEventListener('pointerup', update)
    }
  }, [])

  function clear() {
    window.getSelection()?.removeAllRanges()
    setPending(null)
    setComposer(null)
  }

  function highlight() {
    if (!pending) return
    onCreateHighlight(pending.anchor, highlightColor)
    clear()
  }

  function openComposer(mode: Exclude<Composer, null>) {
    if (!pending) return
    setComposer(mode)
    // Start right away: the tap on the mic is the request to record.
    if (mode === 'voice') void recorder.start()
  }

  async function saveNote(draft: CommentDraft) {
    if (!pending) return
    await onCreateNote({
      ...draft,
      kind: composer === 'suggest' ? 'suggestion' : 'comment',
      anchor: pending.anchor,
    })
    clear()
  }

  const pendingAnchor = pending && composer ? pending.anchor : null

  return (
    <div ref={containerRef} className="markdown-viewer">
      <div ref={paperRef} className="markdown-paper">
        <MarkdownView document={markdown} />
        <Marks
          document={markdown}
          annotations={annotations}
          selectedId={selectedId}
          pendingAnchor={pendingAnchor}
        />
      </div>
      {pending && !composer && (
        <SelectionToolbar
          placement={pending.placement}
          color={highlightColor}
          onColorChange={onHighlightColorChange}
          onHighlight={highlight}
          onComment={() => openComposer('typed')}
          onVoice={() => openComposer('voice')}
          onSuggest={() => openComposer('suggest')}
        />
      )}
      {pending && composer && (
        <CommentComposer
          key={composer}
          placement={pending.placement}
          mode={composer === 'suggest' ? 'suggestion' : 'comment'}
          quote={pending.anchor.quote}
          recorder={composer === 'typed' ? null : recorder}
          transcribe={composer === 'typed' ? null : transcribe}
          cleanUp={composer === 'typed' ? null : cleanUp}
          autoTranscribe={composer === 'typed' ? null : autoTranscribe}
          onSave={saveNote}
          onCancel={clear}
        />
      )}
    </div>
  )
}

/**
 * Returns the anchor and toolbar placement for the current selection, or
 * null when there is no usable selection inside a single block.
 */
function readSelection(
  paper: HTMLDivElement | null,
  container: HTMLDivElement | null,
): PendingAnchor | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null
  }
  if (!paper || !container) return null
  const range = selection.getRangeAt(0)
  const anchor = blockTextAnchorFromRange(range, paper)
  if (!anchor) return null

  // Place the toolbar above the selection, in the scroll container's space.
  const bounds = range.getBoundingClientRect()
  const origin = container.getBoundingClientRect()
  const top = bounds.top - origin.top + container.scrollTop
  return {
    anchor,
    placement: {
      left: bounds.left + bounds.width / 2 - origin.left + container.scrollLeft,
      top,
      bottom: top + bounds.height,
    },
  }
}

interface MarkRect {
  id: string
  kind: 'highlight' | 'comment' | 'suggestion' | 'pending'
  /** A highlight's palette color, 0–255; the CSS mixes in the opacity. */
  color: [number, number, number] | null
  selected: boolean
  left: number
  top: number
  width: number
  height: number
}

interface MarksLayout {
  rects: MarkRect[]
  /** Annotations whose offsets do not fit their block, by message. */
  errors: string[]
}

/**
 * Draws one rectangle per rendered line of every annotation, measured from
 * the DOM after each layout, and again when the paper changes width. An
 * anchor that does not fit its block is reported, never silently skipped.
 */
function Marks({
  document: markdown,
  annotations,
  selectedId,
  pendingAnchor,
}: {
  document: MarkdownDocument
  annotations: readonly Annotation[]
  selectedId: string | null
  pendingAnchor: BlockTextAnchor | null
}) {
  // The layer's own ref is attached before this component's effects run;
  // its parent is the paper the marks are positioned in.
  const layerRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<MarksLayout>({ rects: [], errors: [] })
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const paper = layerRef.current?.parentElement
    if (!paper) return
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width)
    })
    observer.observe(paper)
    return () => observer.disconnect()
  }, [])

  // The marks are measured from the laid-out DOM, which React cannot derive
  // during render: this effect synchronizes with that external layout.
  useLayoutEffect(() => {
    const paper = layerRef.current?.parentElement
    if (!paper) throw new Error('The marks layer has no paper to measure')
    // oxlint-disable-next-line react/set-state-in-effect
    setLayout(measureMarks(paper, annotations, selectedId, pendingAnchor))
  }, [markdown, annotations, selectedId, pendingAnchor, width])

  return (
    <>
      <div ref={layerRef} className="markdown-marks" aria-hidden="true">
        {layout.rects.map((r, i) => (
          <div
            key={`${r.id}-${i}`}
            className={`mark mark--${r.kind}${r.selected ? ' mark--selected' : ''}`}
            data-annotation-id={r.id}
            style={{
              ...(r.color && { '--highlight-rgb': r.color.join(' ') }),
              left: r.left,
              top: r.top,
              width: r.width,
              height: r.height,
            }}
          />
        ))}
      </div>
      {layout.errors.length > 0 && (
        <div role="alert" className="markdown-marks-error">
          {layout.errors.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}
    </>
  )
}

function measureMarks(
  paper: HTMLElement,
  annotations: readonly Annotation[],
  selectedId: string | null,
  pendingAnchor: BlockTextAnchor | null,
): MarksLayout {
  const origin = paper.getBoundingClientRect()
  const rects: MarkRect[] = []
  const errors: string[] = []
  const entries: {
    id: string
    kind: MarkRect['kind']
    color: MarkRect['color']
    anchor: BlockTextAnchor
  }[] = []
  for (const a of annotations) {
    if (a.anchor.type !== 'block-text') {
      errors.push(
        `Annotation ${a.id} has a ${a.anchor.type} anchor, which cannot be shown on a Markdown document`,
      )
      continue
    }
    entries.push({
      id: a.id,
      kind: a.kind,
      color: a.kind === 'highlight' ? highlightRgb(a.color) : null,
      anchor: a.anchor,
    })
  }
  if (pendingAnchor) {
    entries.push({
      id: 'pending',
      kind: 'pending',
      color: null,
      anchor: pendingAnchor,
    })
  }
  for (const { id, kind, color, anchor } of entries) {
    const block = paper.querySelector(`[${BLOCK_ATTRIBUTE}="${anchor.page}"]`)
    if (!block) {
      errors.push(
        `Annotation ${id} points at block ${anchor.page}, which this document does not have`,
      )
      continue
    }
    let range: Range
    try {
      range = rangeForBlockAnchor(block, anchor)
    } catch (err: unknown) {
      errors.push(
        `Annotation ${id} could not be placed: ${err instanceof Error ? err.message : String(err)}`,
      )
      continue
    }
    for (const r of range.getClientRects()) {
      if (r.width === 0 || r.height === 0) continue
      rects.push({
        id,
        kind,
        color,
        selected: id === selectedId,
        left: r.left - origin.left,
        top: r.top - origin.top,
        width: r.width,
        height: r.height,
      })
    }
  }
  return { rects, errors }
}
