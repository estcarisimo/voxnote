import type { PageViewport } from 'pdfjs-dist'
import { rectFromCorners, type PdfRect } from '../core/annotations'
import type { RectLike } from '../core/selection'

/** A rectangle in CSS pixels relative to the page element's top-left. */
export interface CssRect {
  left: number
  top: number
  width: number
  height: number
}

/** The subset of pdf.js's PageViewport that the mapping needs. */
export interface ViewportLike {
  /** `[x1, y1, x2, y2]` of the page's media box in PDF user space. */
  viewBox: number[]
  convertToPdfPoint(x: number, y: number): number[]
  convertToViewportPoint(x: number, y: number): number[]
}

/** What the viewer needs to know about a rendered page to map coordinates. */
export interface PageGeometry {
  page: number
  element: HTMLElement
  textLayer: HTMLElement
  /**
   * Client (viewport) rectangle → PDF user space, clamped to the page's media
   * box so a drag that leaves the page cannot produce coordinates outside it.
   */
  toPdfRect(clientRect: RectLike): PdfRect
  /** PDF user space → CSS pixels relative to the page element. */
  toCssRect(rect: PdfRect): CssRect
}

export function createPageGeometry(
  page: number,
  element: HTMLElement,
  textLayer: HTMLElement,
  viewport: PageViewport | ViewportLike,
): PageGeometry {
  return {
    page,
    element,
    textLayer,
    toPdfRect(clientRect) {
      const origin = element.getBoundingClientRect()
      const [x1, y1] = viewport.convertToPdfPoint(
        clientRect.left - origin.left,
        clientRect.top - origin.top,
      ) as [number, number]
      const [x2, y2] = viewport.convertToPdfPoint(
        clientRect.right - origin.left,
        clientRect.bottom - origin.top,
      ) as [number, number]
      return clampToViewBox(rectFromCorners(x1, y1, x2, y2), viewport.viewBox)
    },
    toCssRect(rect) {
      const [x1, y1] = viewport.convertToViewportPoint(rect.x, rect.y) as [
        number,
        number,
      ]
      const [x2, y2] = viewport.convertToViewportPoint(
        rect.x + rect.width,
        rect.y + rect.height,
      ) as [number, number]
      return {
        left: Math.min(x1, x2),
        top: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
      }
    },
  }
}

/** Intersects `rect` with the media box; a rect fully outside becomes empty. */
export function clampToViewBox(rect: PdfRect, viewBox: number[]): PdfRect {
  const [bx1, by1, bx2, by2] = viewBox as [number, number, number, number]
  const x1 = Math.min(Math.max(rect.x, bx1), bx2)
  const y1 = Math.min(Math.max(rect.y, by1), by2)
  const x2 = Math.min(Math.max(rect.x + rect.width, bx1), bx2)
  const y2 = Math.min(Math.max(rect.y + rect.height, by1), by2)
  return rectFromCorners(x1, y1, x2, y2)
}
