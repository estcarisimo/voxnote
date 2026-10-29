import { useEffect, useRef, useState } from 'react'
import { TextLayer } from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from '../core/pdf'
import './PdfPage.css'

interface PdfPageProps {
  document: PDFDocumentProxy
  pageNumber: number
  /** CSS pixels of width the page should occupy. */
  width: number
}

/**
 * Renders one page: a canvas for the raster and a transparent text layer on
 * top so text can be selected with pointer, touch or pen.
 */
export function PdfPage({ document, pageNumber, width }: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>(Math.round(width * 1.294))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let page: PDFPageProxy | null = null
    let renderTask: ReturnType<PDFPageProxy['render']> | null = null

    async function render() {
      page = await document.getPage(pageNumber)
      if (cancelled) return

      const unscaled = page.getViewport({ scale: 1 })
      const scale = width / unscaled.width
      const viewport = page.getViewport({ scale })
      setHeight(Math.round(viewport.height))

      const canvas = canvasRef.current
      const textLayerDiv = textLayerRef.current
      if (!canvas || !textLayerDiv) return

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
    }
  }, [document, pageNumber, width])

  return (
    <div
      className="pdf-page"
      data-page-number={pageNumber}
      style={{ width, height }}
    >
      <canvas ref={canvasRef} />
      <div ref={textLayerRef} className="textLayer" />
      {error && (
        <div role="alert" className="pdf-page-error">
          Page {pageNumber} failed to render: {error}
        </div>
      )}
    </div>
  )
}
