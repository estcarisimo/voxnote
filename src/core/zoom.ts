/**
 * Document zoom, independent of the browser's page zoom. A zoom is a factor
 * on the fit-to-width page size: 1 is "fit the width", 2 is twice as wide.
 */

export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 4

/** The stops the zoom buttons and keyboard shortcuts step through. */
export const ZOOM_STEPS: readonly number[] = [
  0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4,
]

/** The zoom factor that maps the fit-to-width size. */
export const FIT_ZOOM = 1

/**
 * How a wheel notch translates to zoom: 500 units of `deltaY` double or
 * halve the zoom, so a mouse notch (about 100) is close to one step and a
 * trackpad pinch, which arrives as many small deltas, zooms smoothly.
 */
const WHEEL_DOUBLING_DELTA = 500

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) throw new Error(`Not a zoom factor: ${zoom}`)
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/** The next stop above `zoom`, or the maximum when there is none. */
export function zoomIn(zoom: number): number {
  const next = ZOOM_STEPS.find((step) => step > zoom + 1e-9)
  return next ?? MAX_ZOOM
}

/** The next stop below `zoom`, or the minimum when there is none. */
export function zoomOut(zoom: number): number {
  const steps = [...ZOOM_STEPS].reverse()
  const next = steps.find((step) => step < zoom - 1e-9)
  return next ?? MIN_ZOOM
}

/** The zoom after a Ctrl+wheel (or pinch) of `deltaY` pixels. */
export function zoomByWheel(zoom: number, deltaY: number): number {
  if (!Number.isFinite(deltaY)) throw new Error(`Not a wheel delta: ${deltaY}`)
  return clampZoom(zoom * 2 ** (-deltaY / WHEEL_DOUBLING_DELTA))
}

/** The zoom as the user reads it: "100%" is fit to width. */
export function formatZoom(zoom: number): string {
  return `${Math.round(zoom * 100)}%`
}

/** A page's box in the scroll container's content coordinates. */
export interface PageBox {
  top: number
  left: number
  width: number
  height: number
}

/**
 * The point to hold still while the pages resize: a position inside one
 * page as fractions of its size, and where that point sits in the viewport.
 */
export interface ZoomFocus {
  /** Index into the page boxes. */
  page: number
  fractionX: number
  fractionY: number
  /** The focus point's offset from the viewport's top-left corner. */
  viewportX: number
  viewportY: number
}

/**
 * Locates the content point under (`viewportX`, `viewportY`) of a scroll
 * container at (`scrollLeft`, `scrollTop`) relative to the page that holds
 * it. A point in the gap between pages belongs to the page above it; a
 * point above the first page, to the first page (its fraction is negative).
 */
export function focusAt(
  pages: readonly PageBox[],
  scroll: { top: number; left: number },
  viewportX: number,
  viewportY: number,
): ZoomFocus {
  if (pages.length === 0) throw new Error('No pages to focus on')
  const x = scroll.left + viewportX
  const y = scroll.top + viewportY
  let index = 0
  for (let i = 0; i < pages.length; i++) {
    if (pages[i].top <= y) index = i
    else break
  }
  const page = pages[index]
  return {
    page: index,
    fractionX: page.width > 0 ? (x - page.left) / page.width : 0,
    fractionY: page.height > 0 ? (y - page.top) / page.height : 0,
    viewportX,
    viewportY,
  }
}

/**
 * The scroll offsets that put `focus` back under the same viewport point
 * once the pages have the boxes in `pages`.
 */
export function scrollToFocus(
  pages: readonly PageBox[],
  focus: ZoomFocus,
): { top: number; left: number } {
  const page = pages[focus.page]
  if (!page) throw new Error(`No page at index ${focus.page}`)
  return {
    top: Math.max(
      0,
      page.top + focus.fractionY * page.height - focus.viewportY,
    ),
    left: Math.max(
      0,
      page.left + focus.fractionX * page.width - focus.viewportX,
    ),
  }
}
