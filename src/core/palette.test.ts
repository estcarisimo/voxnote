import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_COLORS,
  HIGHLIGHT_PALETTE,
  highlightPdfColor,
  highlightRgb,
  isHighlightColor,
} from './palette'

describe('highlight palette', () => {
  it('names every color once, with a label and a hex value', () => {
    expect(new Set(HIGHLIGHT_COLORS).size).toBe(HIGHLIGHT_COLORS.length)
    expect(HIGHLIGHT_COLORS).toContain(DEFAULT_HIGHLIGHT_COLOR)
    for (const color of HIGHLIGHT_COLORS) {
      expect(HIGHLIGHT_PALETTE[color].label).not.toBe('')
      expect(HIGHLIGHT_PALETTE[color].hex).toMatch(/^#[0-9a-f]{6}$/)
    }
    const hexes = HIGHLIGHT_COLORS.map((c) => HIGHLIGHT_PALETTE[c].hex)
    expect(new Set(hexes).size).toBe(hexes.length)
  })

  it('accepts palette names only', () => {
    expect(isHighlightColor('yellow')).toBe(true)
    expect(isHighlightColor('purple')).toBe(true)
    expect(isHighlightColor('Yellow')).toBe(false)
    expect(isHighlightColor('#ffdc3c')).toBe(false)
    expect(isHighlightColor('')).toBe(false)
    expect(isHighlightColor(undefined)).toBe(false)
    expect(isHighlightColor(3)).toBe(false)
  })

  it('converts the hex value to 0–255 and to PDF 0..1 components', () => {
    expect(highlightRgb('yellow')).toEqual([255, 220, 60])
    expect(highlightPdfColor('yellow')).toEqual([1, 0.863, 0.235])
    for (const color of HIGHLIGHT_COLORS) {
      for (const c of highlightPdfColor(color)) {
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThanOrEqual(1)
      }
    }
  })
})
