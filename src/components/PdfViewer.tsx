import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react'
import type { Annotation, RegionAnchor, TextAnchor } from '../core/annotations'
import type { PDFDocumentProxy } from '../core/pdf'
import { textAnchorFromRange } from '../core/selection'
import type { PageGeometry } from './geometry'
import { PdfPage, type Tool } from './PdfPage'
import { SelectionToolbar, type ToolbarPlacement } from './SelectionToolbar'
import './PdfViewer.css'

export interface PdfViewerHandle {
  scrollToPage(page: number): void
}

interface PdfViewerProps {
  document: PDFDocumentProxy
  tool: Tool
  annotations: readonly Annotation[]
  selectedId: string | null
  onCreateHighlight: (anchor: TextAnchor | RegionAnchor) => void
  ref?: Ref<PdfViewerHandle>
}

const PAGE_GUTTER = 24
const MAX_PAGE_WIDTH = 900
const SELECTION_SETTLE_MS = 120

interface PendingSelection {
  /** The tool that was active when the selection was read. */
  tool: Tool
  anchor: TextAnchor
  placement: ToolbarPlacement
}

/**
 * Scrolls all pages of a document vertically, fitting them to the width, and
 * turns text selections into highlight anchors via a floating toolbar.
 */
export function PdfViewer({
  document: pdf,
  tool,
  annotations,
  selectedId,
  onCreateHighlight,
  ref,
}: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const geometries = useRef(new Map<number, PageGeometry>())
  const [pageWidth, setPageWidth] = useState(600)
  const [pending, setPending] = useState<PendingSelection | null>(null)

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
  // selection on iOS); pointerup covers the mouse.
  useEffect(() => {
    if (tool !== 'select') return
    let timer: ReturnType<typeof setTimeout> | undefined
    const update = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
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

  // A selection read under another tool is stale once the tool changes.
  const shown = pending && pending.tool === tool ? pending : null

  function createFromSelection() {
    if (!shown) return
    onCreateHighlight(shown.anchor)
    window.getSelection()?.removeAllRanges()
    setPending(null)
  }

  const pageNumbers = Array.from({ length: pdf.numPages }, (_, i) => i + 1)

  return (
    <div ref={containerRef} className="pdf-viewer">
      {pageNumbers.map((n) => (
        <PdfPage
          key={n}
          document={pdf}
          pageNumber={n}
          width={pageWidth}
          tool={tool}
          annotations={annotations.filter((a) => a.anchor.page === n)}
          selectedId={selectedId}
          onGeometry={onGeometry}
          onCreateRegion={onCreateHighlight}
        />
      ))}
      {shown && (
        <SelectionToolbar
          placement={shown.placement}
          onHighlight={createFromSelection}
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
): PendingSelection | null {
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
  return {
    tool,
    anchor,
    placement: {
      left: bounds.left + bounds.width / 2 - origin.left + container.scrollLeft,
      top: bounds.top - origin.top + container.scrollTop,
    },
  }
}
