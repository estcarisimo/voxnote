import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent,
  type Ref,
} from 'react'
import type {
  Anchor,
  Annotation,
  QuoteAnchor,
  RegionAnchor,
  TextAnchor,
} from '../core/annotations'
import type { HighlightColor } from '../core/palette'
import type { PDFDocumentProxy } from '../core/pdf'
import { textAnchorFromRange } from '../core/selection'
import {
  FIT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  focusAt,
  formatZoom,
  scrollToFocus,
  zoomByWheel,
  zoomIn,
  zoomOut,
  type PageBox,
  type ZoomFocus,
} from '../core/zoom'
import { PAGE_ATTRIBUTE, useNearPages } from '../hooks/useNearPages'
import type { AutoTranscribeState } from '../hooks/useTranscription'
import { useComposerDraft } from '../hooks/useComposerDraft'
import type { DraftKeeper } from '../hooks/useDraft'
import type { CleanUpFn } from './CleanUpDialog'
import { CommentComposer, type CommentDraft } from './CommentComposer'
import type { PageGeometry } from './geometry'
import { PdfPage, type Tool } from './PdfPage'
import { SelectionToolbar, type ToolbarPlacement } from './SelectionToolbar'
import type { TranscribeFn } from './TranscribeDialog'
import './PdfViewer.css'

export interface PdfViewerHandle {
  scrollToPage(page: number): void
  /** Brings the annotation's marks into view; falls back to its page. */
  scrollToAnnotation(annotation: Annotation): void
}

export type NewNoteRequest = CommentDraft &
  (
    | { kind: 'comment'; anchor: Anchor }
    | { kind: 'suggestion'; anchor: QuoteAnchor }
  )

interface PdfViewerProps {
  document: PDFDocumentProxy
  tool: Tool
  annotations: readonly Annotation[]
  selectedId: string | null
  /** The color of the next highlight, shown as dots in the toolbar. */
  highlightColor: HighlightColor
  onHighlightColorChange: (color: HighlightColor) => void
  onCreateHighlight: (anchor: Anchor, color: HighlightColor) => void
  /** Rejecting keeps the composer open with the error shown. */
  onCreateNote: (request: NewNoteRequest) => Promise<void>
  /** Consent-gated transcription for a fresh recording; null if unavailable. */
  transcribe: TranscribeFn | null
  /** Consent-gated clean-up of a fresh transcript; null if unavailable. */
  cleanUp?: CleanUpFn | null
  /** Offers "Save and ask…" in the comment composer. */
  canAsk?: boolean
  /** The document's standing consent to transcribe on Stop. */
  autoTranscribe?: AutoTranscribeState | null
  /**
   * Keeps the open composer's draft across crashes. Read once at mount: a
   * draft restored then reopens the composer on its anchor.
   */
  drafts?: DraftKeeper | null
  ref?: Ref<PdfViewerHandle>
}

const PAGE_GUTTER = 24
const MAX_PAGE_WIDTH = 900
const SELECTION_SETTLE_MS = 120
/**
 * How far beyond the visible area pages keep a canvas and a text layer: one
 * screen above and one below. Every other page is an empty box of the right
 * size, so memory and render work follow the screen, not the page count.
 */
const RENDER_MARGIN = '100% 0px'

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
  highlightColor,
  onHighlightColorChange,
  onCreateHighlight,
  onCreateNote,
  transcribe,
  cleanUp = null,
  canAsk = false,
  autoTranscribe = null,
  drafts = null,
  ref,
}: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const geometries = useRef(new Map<number, PageGeometry>())
  // The width that fits the container; the zoom multiplies it.
  const [fitWidth, setFitWidth] = useState(600)
  const [zoom, setZoom] = useState(FIT_ZOOM)
  const pageWidth = Math.round(fitWidth * zoom)
  // The point to hold still across the next page resize, set by a zoom
  // and consumed once the pages have their new size.
  const focusRef = useRef<ZoomFocus | null>(null)
  // A draft kept from before a crash reopens its composer where it was.
  const [pending, setPending] = useState<PendingAnchor | null>(() =>
    restoredPending(drafts),
  )
  const [composer, setComposer] = useState<Composer>(
    () => restoredPending(drafts) && (drafts?.restored?.mode ?? null),
  )
  const composerRef = useRef<Composer>(composer)
  const pendingRef = useRef<PendingAnchor | null>(pending)
  // True while a pen drag is building a selection: the toolbar waits for
  // the pen to lift instead of chasing every intermediate range.
  const penSelectingRef = useRef(false)
  const kept = useComposerDraft(
    drafts,
    composer === 'voice' || composer === 'suggest',
  )
  const { recorder } = kept
  const nearPages = useNearPages(containerRef, pdf.numPages, RENDER_MARGIN)

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

  useEffect(() => {
    pendingRef.current = pending
  }, [pending])

  // Whatever closed the composer, the microphone and replay URL go with it.
  const { discard } = recorder
  useEffect(() => {
    if (composer === null) discard()
  }, [composer, discard])

  useImperativeHandle(ref, () => {
    function scrollToPage(page: number) {
      // Far pages have no geometry: they are not rendered.
      containerRef.current
        ?.querySelector(`[${PAGE_ATTRIBUTE}="${page}"]`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
    return {
      scrollToPage,
      scrollToAnnotation(annotation) {
        // Marks exist only for pages near the screen; a far page gets the
        // page scroll instead, which renders it and makes its marks appear.
        const mark = containerRef.current?.querySelector(
          `[data-annotation-id="${annotation.id}"]`,
        )
        if (mark) {
          mark.scrollIntoView({ block: 'center', behavior: 'smooth' })
        } else {
          scrollToPage(annotation.anchor.page)
        }
      },
    }
  })

  const onPenSelecting = useCallback((active: boolean) => {
    penSelectingRef.current = active
  }, [])

  const onGeometry = useCallback(
    (page: number, geometry: PageGeometry | null) => {
      if (geometry) geometries.current.set(page, geometry)
      else geometries.current.delete(page)
      // A page redrawn at a new size (a zoom, a resize) moves the anchor
      // under an open composer: the composer follows it.
      const held = pendingRef.current
      const container = containerRef.current
      if (geometry && container && held && held.anchor.page === page) {
        const placement = placementFor(held.anchor, geometry, container)
        setPending({ ...held, placement })
      }
    },
    [],
  )

  /**
   * Applies a zoom, holding the content under `at` (viewport coordinates
   * within the scroll container; its center by default) in place. A
   * pending toolbar goes: its text selection does not survive the text
   * layer redrawing. An open composer stays and follows its anchor.
   */
  function applyZoom(next: number, at?: { x: number; y: number }) {
    const container = containerRef.current
    if (!container || next === zoom) return
    const pages = pageBoxes(container)
    if (pages.length > 0) {
      const x = at?.x ?? container.clientWidth / 2
      const y = at?.y ?? container.clientHeight / 2
      focusRef.current = focusAt(
        pages,
        { top: container.scrollTop, left: container.scrollLeft },
        x,
        y,
      )
    }
    if (!composerRef.current) {
      window.getSelection()?.removeAllRanges()
      setPending(null)
    }
    setZoom(next)
  }

  // The pages took their new size in this commit; put the focus back
  // under its viewport point before the browser paints.
  useLayoutEffect(() => {
    const focus = focusRef.current
    const container = containerRef.current
    if (!focus || !container) return
    focusRef.current = null
    const scroll = scrollToFocus(pageBoxes(container), focus)
    container.scrollTop = scroll.top
    container.scrollLeft = scroll.left
  }, [pageWidth])

  // Ctrl+wheel (and a trackpad pinch, which browsers deliver the same way)
  // zooms the document instead of the browser's page. React registers wheel
  // listeners as passive, so the default cannot be prevented from JSX.
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const applyZoomRef = useRef(applyZoom)
  applyZoomRef.current = applyZoom
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const origin = container.getBoundingClientRect()
      applyZoomRef.current(zoomByWheel(zoomRef.current, event.deltaY), {
        x: event.clientX - origin.left,
        y: event.clientY - origin.top,
      })
    }
    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [])

  // Ctrl/Cmd and +, - or 0 zoom the document, as in a desktop PDF reader,
  // unless the keys are typed into a field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement && isEditable(target)) return
      const current = zoomRef.current
      let next: number
      if (event.key === '+' || event.key === '=') next = zoomIn(current)
      else if (event.key === '-' || event.key === '_') next = zoomOut(current)
      else if (event.key === '0') next = FIT_ZOOM
      else return
      event.preventDefault()
      applyZoomRef.current(next)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return
    const fit = (contentWidth: number) =>
      setFitWidth(
        Math.max(200, Math.min(MAX_PAGE_WIDTH, contentWidth - PAGE_GUTTER * 2)),
      )
    // Measured before the first paint: pages sized at a placeholder width
    // and resized a frame later would move every page below the top, and
    // a resume to page N would land well before it.
    const style = getComputedStyle(element)
    fit(element.clientWidth - px(style.paddingLeft) - px(style.paddingRight))
    const observer = new ResizeObserver(([entry]) => {
      fit(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Watch the selection; when it settles inside one page's text layer, offer
  // the toolbar. selectionchange covers touch (no pointerup with a selection
  // on iOS); pointerup covers the mouse and the end of a pen drag, whose
  // range PdfPage builds itself. While a composer is open the anchor is
  // frozen: typing in it moves the DOM selection.
  useEffect(() => {
    if (tool !== 'select') return
    let timer: ReturnType<typeof setTimeout> | undefined
    const update = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (composerRef.current || penSelectingRef.current) return
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
    onCreateHighlight(shown.anchor, highlightColor)
    clear()
  }

  function openComposer(mode: Exclude<Composer, null>) {
    if (!shown) return
    setComposer(mode)
    kept.begin({
      mode,
      anchor: shown.anchor,
      placement: shown.placement,
      body:
        mode === 'suggest' && shown.anchor.type === 'text'
          ? shown.anchor.quote
          : '',
    })
    // Start right away: the tap on the mic is the request to record.
    if (mode === 'voice') void recorder.start()
  }

  async function saveNote(draft: CommentDraft) {
    if (!shown) return
    if (composer === 'suggest') {
      if (shown.anchor.type !== 'text') {
        throw new Error('A suggestion needs selected text')
      }
      await onCreateNote({ ...draft, kind: 'suggestion', anchor: shown.anchor })
    } else {
      await onCreateNote({ ...draft, kind: 'comment', anchor: shown.anchor })
    }
    closeComposer()
  }

  /** Saved, cancelled or discarded: the kept draft goes with the composer. */
  function closeComposer() {
    kept.finish()
    clear()
  }

  function onRegion(anchor: RegionAnchor) {
    const geometry = geometries.current.get(anchor.page)
    const container = containerRef.current
    if (!geometry || !container) return
    setPending({
      tool: 'region',
      anchor,
      placement: placementFor(anchor, geometry, container),
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
  // The page under the toolbar or composer stays rendered even when scrolled
  // far away, so its selection and pending marks survive.
  const heldPage = shown ? shown.anchor.page : null

  return (
    <div className="pdf-viewer-frame">
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
            active={nearPages.has(n) || n === heldPage}
            tool={tool}
            annotations={annotations.filter((a) => a.anchor.page === n)}
            selectedId={selectedId}
            pendingAnchor={pendingAnchor}
            onGeometry={onGeometry}
            onCreateRegion={onRegion}
            onPenSelecting={onPenSelecting}
          />
        ))}
        {shown && !composer && (
          <SelectionToolbar
            placement={shown.placement}
            color={highlightColor}
            onColorChange={onHighlightColorChange}
            onHighlight={highlight}
            onComment={() => openComposer('typed')}
            onVoice={() => openComposer('voice')}
            onSuggest={
              shown.anchor.type === 'text'
                ? () => openComposer('suggest')
                : null
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
            cleanUp={composer === 'typed' ? null : cleanUp}
            autoTranscribe={composer === 'typed' ? null : autoTranscribe}
            onSave={saveNote}
            canAsk={canAsk}
            onCancel={closeComposer}
            restored={kept.restored}
            onDraftChange={drafts ? kept.onDraftChange : undefined}
            onDiscardDraft={closeComposer}
          />
        )}
      </div>
      <div className="pdf-zoom" role="group" aria-label="Zoom">
        <button
          type="button"
          aria-label="Zoom out"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => applyZoom(zoomOut(zoom))}
        >
          −
        </button>
        <button
          type="button"
          className="pdf-zoom-level"
          aria-label={`Zoom ${formatZoom(zoom)}, reset to fit width`}
          disabled={zoom === FIT_ZOOM}
          onClick={() => applyZoom(FIT_ZOOM)}
        >
          {formatZoom(zoom)}
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => applyZoom(zoomIn(zoom))}
        >
          +
        </button>
      </div>
    </div>
  )
}

/**
 * Where the toolbar or composer for `anchor` goes, in the scroll
 * container's content coordinates: centered over the anchor's marks.
 */
function placementFor(
  anchor: TextAnchor | RegionAnchor,
  geometry: PageGeometry,
  container: HTMLDivElement,
): ToolbarPlacement {
  const rects = anchor.type === 'text' ? anchor.rects : [anchor.rect]
  if (rects.length === 0) throw new Error('An anchor needs at least one rect')
  let left = Infinity
  let right = -Infinity
  let top = Infinity
  let bottom = -Infinity
  for (const rect of rects) {
    const css = geometry.toCssRect(rect)
    left = Math.min(left, css.left)
    right = Math.max(right, css.left + css.width)
    top = Math.min(top, css.top)
    bottom = Math.max(bottom, css.top + css.height)
  }
  const page = geometry.element.getBoundingClientRect()
  const origin = container.getBoundingClientRect()
  const pageLeft = page.left - origin.left + container.scrollLeft
  const pageTop = page.top - origin.top + container.scrollTop
  return {
    left: pageLeft + (left + right) / 2,
    top: pageTop + top,
    bottom: pageTop + bottom,
  }
}

/** The pages' boxes in the scroll container's content coordinates. */
function pageBoxes(container: HTMLDivElement): PageBox[] {
  const pages = container.querySelectorAll<HTMLElement>(`[${PAGE_ATTRIBUTE}]`)
  return Array.from(pages, (page) => ({
    top: page.offsetTop,
    left: page.offsetLeft,
    width: page.offsetWidth,
    height: page.offsetHeight,
  }))
}

function isEditable(element: HTMLElement): boolean {
  return (
    element.isContentEditable ||
    element.closest('input, textarea, select, [contenteditable]') !== null
  )
}

/** The anchor of a draft restored at mount, as a pending anchor. */
function restoredPending(drafts: DraftKeeper | null): PendingAnchor | null {
  const restored = drafts?.restored
  if (!restored || restored.anchor.type === 'block-text') return null
  return {
    tool: restored.anchor.type === 'region' ? 'region' : 'select',
    anchor: restored.anchor,
    placement: restored.placement,
  }
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

/** A computed CSS length in pixels; unset (jsdom, no stylesheet) is 0. */
function px(value: string): number {
  if (value === '') return 0
  const n = parseFloat(value)
  if (!Number.isFinite(n)) throw new Error(`Not a pixel length: "${value}"`)
  return n
}
