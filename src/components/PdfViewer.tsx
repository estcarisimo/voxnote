import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from '../core/pdf'
import { PdfPage } from './PdfPage'
import './PdfViewer.css'

interface PdfViewerProps {
  document: PDFDocumentProxy
}

const PAGE_GUTTER = 24
const MAX_PAGE_WIDTH = 900

/** Scrolls all pages of a document vertically, fitting them to the width. */
export function PdfViewer({ document }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pageWidth, setPageWidth] = useState(600)

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

  const pageNumbers = Array.from({ length: document.numPages }, (_, i) => i + 1)

  return (
    <div ref={containerRef} className="pdf-viewer">
      {pageNumbers.map((n) => (
        <PdfPage key={n} document={document} pageNumber={n} width={pageWidth} />
      ))}
    </div>
  )
}
