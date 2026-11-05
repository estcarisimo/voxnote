import type { CSSProperties } from 'react'
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_PALETTE,
  type HighlightColor,
} from '../core/palette'
import './ColorDots.css'

interface ColorDotsProps {
  value: HighlightColor
  onChange: (color: HighlightColor) => void
  /** Names the group, e.g. "Highlight color" or "Color of this highlight". */
  label: string
  disabled?: boolean
}

/**
 * The palette as a row of colored dots, one radio button each. Every dot
 * has a 44 px touch target (Apple's minimum for a fingertip or a Pencil)
 * and the chosen one carries a ring, not just a bigger dot.
 */
export function ColorDots({
  value,
  onChange,
  label,
  disabled = false,
}: ColorDotsProps) {
  return (
    <div className="color-dots" role="radiogroup" aria-label={label}>
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          className="color-dot"
          aria-checked={color === value}
          aria-label={HIGHLIGHT_PALETTE[color].label}
          title={HIGHLIGHT_PALETTE[color].label}
          data-color={color}
          disabled={disabled}
          style={{ '--dot': HIGHLIGHT_PALETTE[color].hex } as CSSVars}
          onClick={() => {
            if (color !== value) onChange(color)
          }}
        />
      ))}
    </div>
  )
}

/** Lets a custom property through React's style typing. */
type CSSVars = CSSProperties & { '--dot': string }
