import { useCallback, useState } from 'react'
import {
  DEFAULT_HIGHLIGHT_COLOR,
  isHighlightColor,
  type HighlightColor,
} from '../core/palette'

export const HIGHLIGHT_COLOR_KEY = 'voxnote.highlight.color'

export interface HighlightColorState {
  /** The color the next highlight will take. */
  color: HighlightColor
  setColor: (color: HighlightColor) => void
  /** Set when the choice could not be remembered; the color still applies. */
  error: string | null
}

/**
 * The color picked for new highlights, kept across reloads in localStorage.
 * A choice that cannot be saved still applies to this session, with the
 * error surfaced rather than swallowed.
 */
export function useHighlightColor(): HighlightColorState {
  const [color, setColorState] = useState<HighlightColor>(loadColor)
  const [error, setError] = useState<string | null>(null)

  const setColor = useCallback((next: HighlightColor) => {
    if (!isHighlightColor(next)) {
      throw new Error(`Unknown highlight color "${String(next)}"`)
    }
    setColorState(next)
    try {
      localStorage.setItem(HIGHLIGHT_COLOR_KEY, next)
      setError(null)
    } catch (err: unknown) {
      setError(
        `The highlight color could not be remembered: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }, [])

  return { color, setColor, error }
}

function loadColor(): HighlightColor {
  let raw: string | null
  try {
    raw = localStorage.getItem(HIGHLIGHT_COLOR_KEY)
  } catch {
    // Storage unreadable (private mode, blocked site data): the default,
    // and the user can pick again. Not worth blocking the app for.
    return DEFAULT_HIGHLIGHT_COLOR
  }
  if (raw === null) return DEFAULT_HIGHLIGHT_COLOR
  if (!isHighlightColor(raw)) {
    throw new Error(
      `Stored highlight color "${raw}" is not in the palette; remove the "${HIGHLIGHT_COLOR_KEY}" entry from localStorage`,
    )
  }
  return raw
}
