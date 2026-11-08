import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react'
import { TextLayer, type PageViewport } from 'pdfjs-dist'
import type { Anchor, Annotation, RegionAnchor } from '../core/annotations'
import { highlightRgb } from '../core/palette'
import type { PDFDocumentProxy, PDFPageProxy } from '../core/pdf'
import { caretLookup, hasStylusTouch, PenSelection } from '../core/penSelection'
import { createPageGeometry, type PageGeometry } from './geometry'
import './PdfPage.css'

export type Tool = 'select' | 'region'

interface PdfPageProps {
  document: PDFDocumentProxy
  pageNumber: number
  /** CSS pixels of width the page should occupy. */
  width: number
  /**
   * Whether the page is near the screen. Only an active page holds a canvas
   * and a text layer; an inactive one is an empty box of the page's size,
   * and going inactive releases the canvas memory.
   */
  active: boolean
  tool: Tool
  annotations: readonly Annotation[]
  selectedId: string | null
  /** An anchor being commented on, drawn until it is saved or dropped. */
  pendingAnchor: Anchor | null
  onGeometry: (page: number, geometry: PageGeometry | null) => void
  onCreateRegion: (anchor: RegionAnchor) => void
  /** Called with true when a pen drag starts selecting text, false at its end. */
  onPenSelecting?: (active: boolean) => void
}

const MIN_REGION_PX = 6
/**
 * A page starts rendering only after it has stayed near the screen this
 * long, so a fast scroll does not paint every page it flies past.
 */
export const RENDER_DELAY_MS = 80

interface PenGesture {
  pointerId: number
  selection: PenSelection
}

interface Draft {
  pointerId: number
  startX: number
  startY: number
  x: number
  y: number
}

/**
 * Renders one page: a canvas for the raster, a highlight layer, and a
 * transparent text layer on top so text can be selected with pointer, touch
 * or pen. In region mode a capture layer sits above everything and turns a
 * drag into a RegionAnchor.
 *
 * Pen selection is app-driven: iPadOS pans the page on a Pencil drag and
 * selects natively only after a long press, so a pen drag on the text layer
 * builds the selection itself (see `PenSelection`). Touch and mouse keep the
 * browser's native selection.
 */
export function PdfPage({
  document,
  pageNumber,
  width,
  active,
  tool,
  annotations,
  selectedId,
  pendingAnchor,
  onGeometry,
  onCreateRegion,
  onPenSelecting,
}: PdfPageProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>(Math.round(width * 1.294))
  // False while the height is still the Letter-shaped estimate.
  const [sized, setSized] = useState(false)
  const [geometry, setGeometry] = useState<PageGeometry | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const penRef = useRef<PenGesture | null>(null)
  const [penError, setPenError] = useState<string | null>(null)

  // Every page, rendered or not, takes its real height, so the scroll
  // position of a page does not move when the pages above it render.
  useEffect(() => {
    let cancelled = false
    document
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) return
        const unscaled = page.getViewport({ scale: 1 })
        setHeight(Math.round((unscaled.height * width) / unscaled.width))
        setSized(true)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [document, pageNumber, width])

  useEffect(() => {
    if (!active) return
    const canvasElement = canvasRef.current
    const textLayerElement = textLayerRef.current
    let cancelled = false
    let page: PDFPageProxy | null = null
    let renderTask: ReturnType<PDFPageProxy['render']> | null = null
    let textLayer: TextLayer | null = null

    async function render() {
      page = await document.getPage(pageNumber)
      if (cancelled) return

      const unscaled = page.getViewport({ scale: 1 })
      const scale = width / unscaled.width
      const viewport: PageViewport = page.getViewport({ scale })

      const root = rootRef.current
      const canvas = canvasRef.current
      const textLayerDiv = textLayerRef.current
      if (!root || !canvas || !textLayerDiv) return

      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`

      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas 2D context unavailable')
      context.setTransform(dpr, 0, 0, dpr, 0, 0)

      renderTask = page.render({ canvas, canvasContext: context, viewport })
      await renderTask.promise
      if (cancelled) return

      textLayerDiv.replaceChildren()
      // The text layer's CSS (PdfPage.css) turns PDF units into CSS pixels
      // with these two, as pdf.js's own viewer sets them.
      textLayerDiv.style.setProperty('--scale-factor', String(scale))
      textLayerDiv.style.setProperty('--user-unit', String(viewport.userUnit))
      textLayer = new TextLayer({
        textContentSource: page.streamTextContent(),
        container: textLayerDiv,
        viewport,
      })
      await textLayer.render()
      if (cancelled) return

      setGeometry(createPageGeometry(pageNumber, root, textLayerDiv, viewport))
      // A page draws many times per session: a later success clears an
      // earlier failure.
      setError(null)
    }

    const start = setTimeout(() => {
      render().catch(fail)
    }, RENDER_DELAY_MS)
    function fail(err: unknown) {
      // pdf.js rejects the previous render when a new one starts; that is
      // expected during resize and not an error worth surfacing.
      if (cancelled) return
      setError(err instanceof Error ? err.message : String(err))
    }

    return () => {
      cancelled = true
      clearTimeout(start)
      renderTask?.cancel()
      textLayer?.cancel()
      page?.cleanup()
      setGeometry(null)
      // Zero-size backing store: the browser frees the pixels now instead
      // of keeping them for a page that is off screen or about to redraw.
      // The cost: during a drag-resize the visible pages stay blank until
      // the width has held for RENDER_DELAY_MS.
      if (canvasElement) {
        canvasElement.width = 0
        canvasElement.height = 0
      }
      textLayerElement?.replaceChildren()
    }
  }, [document, pageNumber, width, active])

  useEffect(() => {
    onGeometry(pageNumber, geometry)
    return () => onGeometry(pageNumber, null)
  }, [geometry, onGeometry, pageNumber])

  // Panning is not a pointer-event default (Pointer Events 3, 4.1.3.1), and
  // touch-action applies to touch and stylus alike (section 8), so no CSS
  // value lets a finger scroll while a pen selects. The pen's pan is
  // cancelled at the touch-event level instead: WebKit marks Pencil touches
  // with touchType 'stylus', and any touch during a pen gesture is blocked
  // too, as palm rejection (a deliberate finger scroll waits for the pen).
  // React registers touch listeners as passive, hence addEventListener.
  useEffect(() => {
    const layer = textLayerRef.current
    if (!layer || tool !== 'select') return
    const blockPenPan = (event: TouchEvent) => {
      if (penRef.current || hasStylusTouch(event.changedTouches)) {
        event.preventDefault()
      }
    }
    layer.addEventListener('touchstart', blockPenPan, { passive: false })
    layer.addEventListener('touchmove', blockPenPan, { passive: false })
    return () => {
      layer.removeEventListener('touchstart', blockPenPan)
      layer.removeEventListener('touchmove', blockPenPan)
    }
  }, [tool])

  // A tool switch or unmount removes the handlers that would see the pen
  // lift; end the gesture here so neither this page nor the viewer stays
  // stuck in it.
  useEffect(() => {
    const layer = textLayerRef.current
    return () => {
      setPenError(null)
      const pen = penRef.current
      if (!pen) return
      penRef.current = null
      if (layer?.hasPointerCapture(pen.pointerId)) {
        layer.releasePointerCapture(pen.pointerId)
      }
      showSelection(null)
      onPenSelecting?.(false)
    }
  }, [tool, onPenSelecting])

  function penDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'pen' || event.button !== 0) return
    if (penRef.current) return
    const layer = event.currentTarget
    let lookup
    try {
      lookup = caretLookup(layer.ownerDocument)
    } catch (err) {
      setPenError(err instanceof Error ? err.message : String(err))
      return
    }
    // Keeps WebKit from starting its own gesture and stops the compatibility
    // mousedown, whose default would start a native selection.
    event.preventDefault()
    layer.setPointerCapture(event.pointerId)
    setPenError(null)
    showSelection(null)
    penRef.current = {
      pointerId: event.pointerId,
      selection: new PenSelection(
        layer,
        { x: event.clientX, y: event.clientY },
        lookup,
      ),
    }
    onPenSelecting?.(true)
  }

  function penMove(event: PointerEvent<HTMLDivElement>) {
    const pen = penRef.current
    if (!pen || event.pointerId !== pen.pointerId) return
    event.preventDefault()
    const range = pen.selection.move({ x: event.clientX, y: event.clientY })
    if (range) showSelection(range)
  }

  function penEnd(event: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const pen = penRef.current
    if (!pen || event.pointerId !== pen.pointerId) return
    penRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    // A tap or a cancelled gesture leaves no selection behind.
    const range = cancelled ? null : pen.selection.range()
    showSelection(range)
    onPenSelecting?.(false)
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!geometry || draft || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const origin = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - origin.left
    const y = event.clientY - origin.top
    setDraft({ pointerId: event.pointerId, startX: x, startY: y, x, y })
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!draft || event.pointerId !== draft.pointerId) return
    const origin = event.currentTarget.getBoundingClientRect()
    setDraft({
      ...draft,
      x: event.clientX - origin.left,
      y: event.clientY - origin.top,
    })
  }

  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!draft || !geometry || event.pointerId !== draft.pointerId) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    const css = draftRect(draft)
    setDraft(null)
    // A tap, not a drag: nothing to anchor.
    if (css.width < MIN_REGION_PX || css.height < MIN_REGION_PX) return
    const origin = event.currentTarget.getBoundingClientRect()
    const rect = geometry.toPdfRect({
      left: origin.left + css.left,
      top: origin.top + css.top,
      right: origin.left + css.left + css.width,
      bottom: origin.top + css.top + css.height,
      width: css.width,
      height: css.height,
    })
    // Clamping to the page can collapse a drag that was mostly outside it.
    if (rect.width === 0 || rect.height === 0) return
    onCreateRegion({ type: 'region', page: pageNumber, rect })
  }

  return (
    <div
      ref={rootRef}
      className="pdf-page"
      data-page-number={pageNumber}
      data-sized={sized || undefined}
      style={{ width, height }}
    >
      {/* No backing store until the page renders: a bare canvas would hold
          300 x 150 pixels on every page of the document. */}
      <canvas ref={canvasRef} width={0} height={0} />
      <div className="highlightLayer" aria-hidden="true">
        {geometry &&
          annotations.map((a) => (
            <Marks
              key={a.id}
              id={a.id}
              anchor={a.anchor}
              geometry={geometry}
              kind={a.kind}
              color={a.kind === 'highlight' ? highlightRgb(a.color) : null}
              selected={a.id === selectedId}
            />
          ))}
        {geometry && pendingAnchor && pendingAnchor.page === pageNumber && (
          <Marks
            id="pending"
            anchor={pendingAnchor}
            geometry={geometry}
            kind="pending"
          />
        )}
      </div>
      <div
        ref={textLayerRef}
        className="textLayer"
        {...(tool === 'select' && {
          onPointerDown: penDown,
          onPointerMove: penMove,
          onPointerUp: (e: PointerEvent<HTMLDivElement>) => penEnd(e, false),
          onPointerCancel: (e: PointerEvent<HTMLDivElement>) => penEnd(e, true),
          // Capture lost before the pen lifted: treat it as a cancel.
          onLostPointerCapture: (e: PointerEvent<HTMLDivElement>) =>
            penEnd(e, true),
        })}
      />
      {tool === 'region' && (
        <div
          className="regionCapture"
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={(e) => {
            if (draft && e.pointerId === draft.pointerId) setDraft(null)
          }}
        >
          {draft && <div className="regionDraft" style={draftRect(draft)} />}
        </div>
      )}
      {error && (
        <div role="alert" className="pdf-page-error">
          Page {pageNumber} failed to render: {error}
        </div>
      )}
      {penError && (
        <div role="alert" className="pdf-page-error">
          {penError}
        </div>
      )}
    </div>
  )
}

/** Shows `range` as the document selection, or clears it for null. */
function showSelection(range: Range | null) {
  const selection = window.getSelection()
  if (!selection) throw new Error('window.getSelection() returned null')
  selection.removeAllRanges()
  if (range) selection.addRange(range)
}

function draftRect(d: Draft) {
  return {
    left: Math.min(d.startX, d.x),
    top: Math.min(d.startY, d.y),
    width: Math.abs(d.x - d.startX),
    height: Math.abs(d.y - d.startY),
  }
}

function Marks({
  id,
  anchor,
  geometry,
  kind,
  color = null,
  selected = false,
}: {
  id: string
  anchor: Anchor
  geometry: PageGeometry
  kind: 'highlight' | 'comment' | 'suggestion' | 'pending'
  /** A highlight's palette color, 0–255; the CSS mixes in the opacity. */
  color?: [number, number, number] | null
  selected?: boolean
}) {
  if (anchor.type === 'block-text') {
    throw new Error(`Annotation ${id} belongs to a Markdown document`)
  }
  const rects = anchor.type === 'text' ? anchor.rects : [anchor.rect]
  const className = `highlight highlight--${anchor.type} highlight--${kind}${selected ? ' highlight--selected' : ''}`
  const tint = color ? { '--highlight-rgb': color.join(' ') } : null
  return (
    <>
      {rects.map((r, i) => (
        <div
          key={i}
          className={className}
          data-annotation-id={id}
          style={{ ...geometry.toCssRect(r), ...tint } as CSSProperties}
        />
      ))}
    </>
  )
}
