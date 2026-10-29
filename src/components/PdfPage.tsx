import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { TextLayer, type PageViewport } from 'pdfjs-dist'
import type { Annotation, RegionAnchor } from '../core/annotations'
import type { PDFDocumentProxy, PDFPageProxy } from '../core/pdf'
import { createPageGeometry, type PageGeometry } from './geometry'
import './PdfPage.css'

export type Tool = 'select' | 'region'

interface PdfPageProps {
  document: PDFDocumentProxy
  pageNumber: number
  /** CSS pixels of width the page should occupy. */
  width: number
  tool: Tool
  annotations: readonly Annotation[]
  selectedId: string | null
  onGeometry: (page: number, geometry: PageGeometry | null) => void
  onCreateRegion: (anchor: RegionAnchor) => void
}

const MIN_REGION_PX = 6

interface Draft {
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
 */
export function PdfPage({
  document,
  pageNumber,
  width,
  tool,
  annotations,
  selectedId,
  onGeometry,
  onCreateRegion,
}: PdfPageProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>(Math.round(width * 1.294))
  const [geometry, setGeometry] = useState<PageGeometry | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)

  useEffect(() => {
    let cancelled = false
    let page: PDFPageProxy | null = null
    let renderTask: ReturnType<PDFPageProxy['render']> | null = null

    async function render() {
      page = await document.getPage(pageNumber)
      if (cancelled) return

      const unscaled = page.getViewport({ scale: 1 })
      const scale = width / unscaled.width
      const viewport: PageViewport = page.getViewport({ scale })
      setHeight(Math.round(viewport.height))

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
      textLayerDiv.style.setProperty('--scale-factor', String(scale))
      const textLayer = new TextLayer({
        textContentSource: page.streamTextContent(),
        container: textLayerDiv,
        viewport,
      })
      await textLayer.render()
      if (cancelled) return

      setGeometry(createPageGeometry(pageNumber, root, textLayerDiv, viewport))
    }

    render().catch((err: unknown) => {
      // pdf.js rejects the previous render when a new one starts; that is
      // expected during resize and not an error worth surfacing.
      if (cancelled) return
      setError(err instanceof Error ? err.message : String(err))
    })

    return () => {
      cancelled = true
      renderTask?.cancel()
      page?.cleanup()
      setGeometry(null)
    }
  }, [document, pageNumber, width])

  useEffect(() => {
    onGeometry(pageNumber, geometry)
    return () => onGeometry(pageNumber, null)
  }, [geometry, onGeometry, pageNumber])

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!geometry || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const origin = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - origin.left
    const y = event.clientY - origin.top
    setDraft({ startX: x, startY: y, x, y })
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!draft) return
    const origin = event.currentTarget.getBoundingClientRect()
    setDraft({
      ...draft,
      x: event.clientX - origin.left,
      y: event.clientY - origin.top,
    })
  }

  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!draft || !geometry) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    const css = draftRect(draft)
    setDraft(null)
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
    onCreateRegion({ type: 'region', page: pageNumber, rect })
  }

  return (
    <div
      ref={rootRef}
      className="pdf-page"
      data-page-number={pageNumber}
      style={{ width, height }}
    >
      <canvas ref={canvasRef} />
      <div className="highlightLayer" aria-hidden="true">
        {geometry &&
          annotations.map((a) => (
            <HighlightMarks
              key={a.id}
              annotation={a}
              geometry={geometry}
              selected={a.id === selectedId}
            />
          ))}
      </div>
      <div ref={textLayerRef} className="textLayer" />
      {tool === 'region' && (
        <div
          className="regionCapture"
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={() => setDraft(null)}
        >
          {draft && <div className="regionDraft" style={draftRect(draft)} />}
        </div>
      )}
      {error && (
        <div role="alert" className="pdf-page-error">
          Page {pageNumber} failed to render: {error}
        </div>
      )}
    </div>
  )
}

function draftRect(d: Draft) {
  return {
    left: Math.min(d.startX, d.x),
    top: Math.min(d.startY, d.y),
    width: Math.abs(d.x - d.startX),
    height: Math.abs(d.y - d.startY),
  }
}

function HighlightMarks({
  annotation,
  geometry,
  selected,
}: {
  annotation: Annotation
  geometry: PageGeometry
  selected: boolean
}) {
  const { anchor } = annotation
  const rects = anchor.type === 'text' ? anchor.rects : [anchor.rect]
  const className = `highlight highlight--${anchor.type}${selected ? ' highlight--selected' : ''}`
  return (
    <>
      {rects.map((r, i) => (
        <div
          key={i}
          className={className}
          data-annotation-id={annotation.id}
          style={geometry.toCssRect(r)}
        />
      ))}
    </>
  )
}
