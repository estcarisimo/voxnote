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

/** What the viewer needs to know about a rendered page to map coordinates. */
export interface PageGeometry {
  page: number
  element: HTMLElement
  textLayer: HTMLElement
  toPdfRect(clientRect: RectLike): PdfRect
  toCssRect(rect: PdfRect): CssRect
}

export function createPageGeometry(
  page: number,
  element: HTMLElement,
  textLayer: HTMLElement,
  viewport: PageViewport,
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
      return rectFromCorners(x1, y1, x2, y2)
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
