/**
 * The fixed palette a highlight can take. One place for the names and the
 * hex values, so the marks on screen, the dots in the toolbar and the
 * native annotations in the exported PDF all show the same color.
 */

export const HIGHLIGHT_COLORS = [
  'yellow',
  'green',
  'blue',
  'pink',
  'orange',
  'purple',
] as const

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = 'yellow'

interface PaletteEntry {
  /** The accessible name of the color. */
  label: string
  /** `#rrggbb`, the color of the mark at full opacity. */
  hex: string
}

export const HIGHLIGHT_PALETTE: Readonly<Record<HighlightColor, PaletteEntry>> =
  {
    yellow: { label: 'Yellow', hex: '#ffdc3c' },
    green: { label: 'Green', hex: '#7ddc6e' },
    blue: { label: 'Blue', hex: '#78b4ff' },
    pink: { label: 'Pink', hex: '#ff8cc8' },
    orange: { label: 'Orange', hex: '#ffa550' },
    purple: { label: 'Purple', hex: '#c89bff' },
  }

export function isHighlightColor(value: unknown): value is HighlightColor {
  return (
    typeof value === 'string' &&
    (HIGHLIGHT_COLORS as readonly string[]).includes(value)
  )
}

/** Red, green and blue as 0–255 integers. */
export function highlightRgb(color: HighlightColor): [number, number, number] {
  const hex = HIGHLIGHT_PALETTE[color].hex
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

/**
 * The color as a PDF `/C` array: three components in 0..1 (PDF 32000-1,
 * 12.5.2), rounded to three decimals so the file stays readable.
 */
export function highlightPdfColor(
  color: HighlightColor,
): [number, number, number] {
  const [r, g, b] = highlightRgb(color)
  const unit = (v: number) => Math.round((v / 255) * 1000) / 1000
  return [unit(r), unit(g), unit(b)]
}
