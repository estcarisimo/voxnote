import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent,
  type Ref,
} from 'react'
import type {
  Anchor,
  Annotation,
  RegionAnchor,
  TextAnchor,
} from '../core/annotations'
import type { PDFDocumentProxy } from '../core/pdf'
import { textAnchorFromRange } from '../core/selection'
import { useVoiceRecorder } from '../hooks/useVoiceRecorder'
import { CommentComposer, type CommentDraft } from './CommentComposer'
import type { PageGeometry } from './geometry'
import { PdfPage, type Tool } from './PdfPage'
import { SelectionToolbar, type ToolbarPlacement } from './SelectionToolbar'
import type { TranscribeFn } from './TranscribeDialog'
import './PdfViewer.css'

export interface PdfViewerHandle {
  scrollToPage(page: number): void
}

export interface NewNoteRequest extends CommentDraft {
  kind: 'comment' | 'suggestion'
  anchor: Anchor
}

interface PdfViewerProps {
  document: PDFDocumentProxy
  tool: Tool
  annotations: readonly Annotation[]
  selectedId: string | null
  onCreateHighlight: (anchor: Anchor) => void
  /** Rejecting keeps the composer open with the error shown. */
  onCreateNote: (request: NewNoteRequest) => Promise<void>
  /** Consent-gated transcription for a fresh recording; null if unavailable. */
  transcribe: TranscribeFn | null
  ref?: Ref<PdfViewerHandle>
}

const PAGE_GUTTER = 24
const MAX_PAGE_WIDTH = 900
const SELECTION_SETTLE_MS = 120

interface PendingAnchor {
  /** The tool that was active when the anchor was read. */
  tool: Tool
  anchor: TextAnchor | RegionAnchor
  placement: ToolbarPlacement
}

/**
 * typed: a comment without recorder; voice: a comment, recording at once;
 * suggest: a replacement for the selected text, with the recorder on hand.
 */
type Composer = 'typed' | 'voice' | 'suggest' | null

/**
 * Scrolls all pages of a document vertically, fitting them to the width, and
 * turns text selections and region drags into anchors: a floating toolbar
 * offers a highlight or a comment (typed or dictated) for each.
 */
export function PdfViewer({
  document: pdf,
  tool,
  annotations,
  selectedId,
  onCreateHighlight,
  onCreateNote,
  transcribe,
  ref,
}: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const geometries = useRef(new Map<number, PageGeometry>())
  const [pageWidth, setPageWidth] = useState(600)
  const [pending, setPending] = useState<PendingAnchor | null>(null)
  const [composer, setComposer] = useState<Composer>(null)
  const composerRef = useRef<Composer>(null)
  const recorder = useVoiceRecorder()

  // A tool switch drops whatever was pending: a region anchor must not
  // reappear later, and a composer must not survive hidden with its
  // recorder running. Adjusting state during render is React's pattern
  // for reacting to a prop change.
  const [seenTool, setSeenTool] = useState(tool)
  if (seenTool !== tool) {
    setSeenTool(tool)
    setPending(null)
    setComposer(null)
  }

  useEffect(() => {
    composerRef.current = composer
  }, [composer])

  // Whatever closed the composer, the microphone and replay URL go with it.
  const { discard } = recorder
  useEffect(() => {
    if (composer === null) discard()
  }, [composer, discard])

  useImperativeHandle(ref, () => ({
    scrollToPage(page) {
      geometries.current
        .get(page)
        ?.element.scrollIntoView({ block: 'start', behavior: 'smooth' })
    },
  }))

  const onGeometry = useCallback(
    (page: number, geometry: PageGeometry | null) => {
      if (geometry) geometries.current.set(page, geometry)
      else geometries.current.delete(page)
    },
    [],
  )

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const available = entry.contentRect.width - PAGE_GUTTER * 2
      setPageWidth(Math.max(200, Math.min(MAX_PAGE_WIDTH, available)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Watch the selection; when it settles inside one page's text layer, offer
  // the toolbar. selectionchange covers touch and pen (no pointerup with a
  // selection on iOS); pointerup covers the mouse. While a composer is open
  // the anchor is frozen: typing in it moves the DOM selection.
  useEffect(() => {
    if (tool !== 'select') return
    let timer: ReturnType<typeof setTimeout> | undefined
    const update = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (composerRef.current) return
        setPending(
          readSelection(geometries.current, containerRef.current, tool),
        )
      }, SELECTION_SETTLE_MS)
    }
    document.addEventListener('selectionchange', update)
    document.addEventListener('pointerup', update)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('selectionchange', update)
      document.removeEventListener('pointerup', update)
    }
  }, [tool])

  // An anchor read under another tool is stale once the tool changes.
  const shown = pending && pending.tool === tool ? pending : null

  function clear() {
    window.getSelection()?.removeAllRanges()
    setPending(null)
    setComposer(null)
  }

  function highlight() {
    if (!shown) return
    onCreateHighlight(shown.anchor)
    clear()
  }

  function openComposer(mode: Exclude<Composer, null>) {
    if (!shown) return
    setComposer(mode)
    // Start right away: the tap on the mic is the request to record.
    if (mode === 'voice') void recorder.start()
  }

  async function saveNote(draft: CommentDraft) {
    if (!shown) return
    await onCreateNote({
      ...draft,
      kind: composer === 'suggest' ? 'suggestion' : 'comment',
      anchor: shown.anchor,
    })
    clear()
  }

  function onRegion(anchor: RegionAnchor) {
    const geometry = geometries.current.get(anchor.page)
    const container = containerRef.current
    if (!geometry || !container) return
    const css = geometry.toCssRect(anchor.rect)
    const page = geometry.element.getBoundingClientRect()
    const origin = container.getBoundingClientRect()
    const left = page.left - origin.left + container.scrollLeft
    const top = page.top - origin.top + container.scrollTop
    setPending({
      tool: 'region',
      anchor,
      placement: {
        left: left + css.left + css.width / 2,
        top: top + css.top,
        bottom: top + css.top + css.height,
      },
    })
  }

  // A region anchor has no DOM selection to collapse: a tap anywhere else
  // dismisses it, unless a composer is open.
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!shown || shown.tool !== 'region' || composer) return
    const target = event.target as Element
    if (target.closest('.selection-toolbar')) return
    setPending(null)
  }

  const pageNumbers = Array.from({ length: pdf.numPages }, (_, i) => i + 1)
  const pendingAnchor = shown && composer ? shown.anchor : null

  return (
    <div
      ref={containerRef}
      className="pdf-viewer"
      onPointerDownCapture={pointerDown}
    >
      {pageNumbers.map((n) => (
        <PdfPage
          key={n}
          document={pdf}
          pageNumber={n}
          width={pageWidth}
          tool={tool}
          annotations={annotations.filter((a) => a.anchor.page === n)}
          selectedId={selectedId}
          pendingAnchor={pendingAnchor}
          onGeometry={onGeometry}
          onCreateRegion={onRegion}
        />
      ))}
      {shown && !composer && (
        <SelectionToolbar
          placement={shown.placement}
          onHighlight={highlight}
          onComment={() => openComposer('typed')}
          onVoice={() => openComposer('voice')}
          onSuggest={
            shown.anchor.type === 'text' ? () => openComposer('suggest') : null
          }
        />
      )}
      {shown && composer && (
        <CommentComposer
          key={composer}
          placement={shown.placement}
          mode={composer === 'suggest' ? 'suggestion' : 'comment'}
          quote={shown.anchor.type === 'text' ? shown.anchor.quote : null}
          recorder={composer === 'typed' ? null : recorder}
          transcribe={composer === 'typed' ? null : transcribe}
          onSave={saveNote}
          onCancel={clear}
        />
      )}
    </div>
  )
}

/**
 * Returns the anchor and toolbar placement for the current selection, or
 * null when there is no usable selection inside a single page.
 */
function readSelection(
  geometries: Map<number, PageGeometry>,
  container: HTMLDivElement | null,
  tool: Tool,
): PendingAnchor | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null
  }
  if (!container) return null
  const range = selection.getRangeAt(0)
  let geometry: PageGeometry | undefined
  for (const g of geometries.values()) {
    if (g.textLayer.contains(range.commonAncestorContainer)) {
      geometry = g
      break
    }
  }
  if (!geometry) return null

  const anchor = textAnchorFromRange(range, {
    page: geometry.page,
    textLayer: geometry.textLayer,
    clientRects: Array.from(range.getClientRects()),
    toPdfRect: geometry.toPdfRect,
  })
  if (!anchor) return null

  // Place the toolbar above the selection, in the scroll container's space.
  const bounds = range.getBoundingClientRect()
  const origin = container.getBoundingClientRect()
  const top = bounds.top - origin.top + container.scrollTop
  return {
    tool,
    anchor,
    placement: {
      left: bounds.left + bounds.width / 2 - origin.left + container.scrollLeft,
      top,
      bottom: top + bounds.height,
    },
  }
}
