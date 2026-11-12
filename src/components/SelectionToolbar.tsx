import { useRef, type PointerEvent, type SyntheticEvent } from 'react'
import type { HighlightColor } from '../core/palette'
import { ColorDots } from './ColorDots'
import './SelectionToolbar.css'

export interface ToolbarPlacement {
  /** Horizontal center, in the scroll container's content coordinates. */
  left: number
  /** Top edge of the anchored area; the toolbar sits above it. */
  top: number
  /** Bottom edge of the anchored area; the composer opens below it. */
  bottom: number
}

interface SelectionToolbarProps {
  placement: ToolbarPlacement
  /** The color the next highlight will take; the dots show and change it. */
  color: HighlightColor
  onColorChange: (color: HighlightColor) => void
  onHighlight: () => void
  onComment: () => void
  onVoice: () => void
  /** Only text can be replaced: null hides the action for regions. */
  onSuggest: (() => void) | null
  /** Ask a model about the passage; null hides it (regions, unavailable). */
  onAsk?: (() => void) | null
}

/**
 * Floating actions for the current selection or region.
 *
 * The toolbar lives only as long as the text selection under it: the viewer
 * re-reads the selection after every tap and drops the toolbar when it is
 * gone. Canceling pointerdown keeps the selection through a mouse click, but
 * a touch or Pencil tap still collapses it on iPadOS. Highlight and Comment
 * act on the anchor at once, so they never noticed; picking a color did
 * nothing with the anchor and lost the toolbar. The range is held on press
 * and put back after the tap, so the pick leaves the toolbar in place.
 */
export function SelectionToolbar({
  placement,
  color,
  onColorChange,
  onHighlight,
  onComment,
  onVoice,
  onSuggest,
  onAsk = null,
}: SelectionToolbarProps) {
  const heldRange = useRef<Range | null>(null)

  function hold(event: PointerEvent<HTMLDivElement>) {
    // Keep the selection: a pointerdown on the toolbar must not collapse it.
    event.preventDefault()
    const selection = window.getSelection()
    heldRange.current =
      selection && selection.rangeCount > 0 && !selection.isCollapsed
        ? selection.getRangeAt(0).cloneRange()
        : null
  }

  /**
   * Puts the held range back if the tap collapsed it. Runs on pointerup
   * and again in the capture phase of click, before the button's own
   * handler, so an action sees the selection it was offered for.
   */
  function restore(event: SyntheticEvent<HTMLDivElement>) {
    const held = heldRange.current
    if (!held) return
    if (event.type === 'click') heldRange.current = null
    const selection = window.getSelection()
    if (!selection || !selection.isCollapsed) return
    selection.removeAllRanges()
    selection.addRange(held)
  }

  return (
    <div
      className="selection-toolbar"
      role="toolbar"
      aria-label="Selection actions"
      style={{ left: placement.left, top: placement.top }}
      onPointerDown={hold}
      onPointerUp={restore}
      onClickCapture={restore}
    >
      <ColorDots
        value={color}
        onChange={onColorChange}
        label="Highlight color"
      />
      <button type="button" onClick={onHighlight}>
        Highlight
      </button>
      <button type="button" onClick={onComment}>
        Comment
      </button>
      <button type="button" onClick={onVoice} aria-label="Voice comment">
        🎤 Voice
      </button>
      {onSuggest && (
        <button type="button" onClick={onSuggest}>
          Suggest
        </button>
      )}
      {onAsk && (
        <button
          type="button"
          onClick={onAsk}
          title="Ask a model about this passage"
        >
          ❓ Ask
        </button>
      )}
    </div>
  )
}
