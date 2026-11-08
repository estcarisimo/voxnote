import { describe, expect, it } from 'vitest'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEPS,
  clampZoom,
  focusAt,
  formatZoom,
  scrollToFocus,
  zoomByWheel,
  zoomIn,
  zoomOut,
  type PageBox,
} from './zoom'

describe('zoom steps', () => {
  it('steps up and down through the stops from fit', () => {
    expect(zoomIn(1)).toBe(1.1)
    expect(zoomOut(1)).toBe(0.9)
  })

  it('snaps a value between stops to the next stop in that direction', () => {
    expect(zoomIn(1.05)).toBe(1.1)
    expect(zoomOut(1.05)).toBe(1)
  })

  it('stops at the ends', () => {
    expect(zoomIn(MAX_ZOOM)).toBe(MAX_ZOOM)
    expect(zoomOut(MIN_ZOOM)).toBe(MIN_ZOOM)
    expect(ZOOM_STEPS[0]).toBe(MIN_ZOOM)
    expect(ZOOM_STEPS.at(-1)).toBe(MAX_ZOOM)
  })

  it('clamps to the range and rejects non-numbers', () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM)
    expect(clampZoom(10)).toBe(MAX_ZOOM)
    expect(clampZoom(1.3)).toBe(1.3)
    expect(() => clampZoom(Number.NaN)).toThrow('Not a zoom factor')
  })

  it('zooms in on a wheel up and out on a wheel down, within the range', () => {
    expect(zoomByWheel(1, -500)).toBe(2)
    expect(zoomByWheel(1, 500)).toBe(0.5)
    expect(zoomByWheel(1, -100)).toBeCloseTo(1.1487, 3)
    expect(zoomByWheel(MAX_ZOOM, -100)).toBe(MAX_ZOOM)
    expect(() => zoomByWheel(1, Number.NaN)).toThrow('Not a wheel delta')
  })

  it('formats as a whole percentage', () => {
    expect(formatZoom(1)).toBe('100%')
    expect(formatZoom(0.67)).toBe('67%')
    expect(formatZoom(1.2549)).toBe('125%')
  })
})

describe('zoom focus', () => {
  // Two Letter-shaped pages 600 wide with a 16 px gap, 24 px in from the
  // container's top-left, as the viewer lays them out.
  const before: PageBox[] = [
    { top: 24, left: 24, width: 600, height: 776 },
    { top: 816, left: 24, width: 600, height: 776 },
  ]
  // The same pages at twice the zoom.
  const after: PageBox[] = [
    { top: 24, left: 24, width: 1200, height: 1552 },
    { top: 1592, left: 24, width: 1200, height: 1552 },
  ]

  it('keeps the point under the cursor still across a zoom', () => {
    // Scrolled 480 down, cursor 300 down and 200 across the viewport: that
    // is 780 px into the content, 756 px into page 1 (fraction 0.974).
    const focus = focusAt(before, { top: 480, left: 0 }, 200, 300)
    expect(focus.page).toBe(0)
    expect(focus.fractionY).toBeCloseTo(756 / 776)
    expect(focus.fractionX).toBeCloseTo(176 / 600)
    const scroll = scrollToFocus(after, focus)
    // Page 1 at twice the size: the same point is at 24 + 1512 = 1536,
    // and it must stay 300 px below the viewport's top.
    expect(scroll.top).toBeCloseTo(1536 - 300)
    expect(scroll.left).toBeCloseTo(24 + 352 - 200)
  })

  it('assigns a point in the gap to the page above it', () => {
    const focus = focusAt(before, { top: 805, left: 0 }, 0, 0)
    expect(focus.page).toBe(0)
    expect(focus.fractionY).toBeGreaterThan(1)
  })

  it('assigns a point above the first page to the first page', () => {
    const focus = focusAt(before, { top: 0, left: 0 }, 0, 10)
    expect(focus.page).toBe(0)
    expect(focus.fractionY).toBeLessThan(0)
  })

  it('never scrolls to a negative offset', () => {
    // Zooming out to half with the focus 100 px into the viewport would
    // ask for a scroll of -38 px on both axes.
    const focus = focusAt(before, { top: 0, left: 0 }, 100, 100)
    const scroll = scrollToFocus(
      before.map((p) => ({ ...p, width: 300, height: 388 })),
      focus,
    )
    expect(scroll.top).toBe(0)
    expect(scroll.left).toBe(0)
  })

  it('fails loudly without pages or with a stale page index', () => {
    expect(() => focusAt([], { top: 0, left: 0 }, 0, 0)).toThrow(
      'No pages to focus on',
    )
    const focus = focusAt(before, { top: 0, left: 0 }, 0, 0)
    expect(() => scrollToFocus([], focus)).toThrow('No page at index 0')
  })
})
