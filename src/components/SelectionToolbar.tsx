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
  onHighlight: () => void
  onComment: () => void
  onVoice: () => void
}

/** Floating actions for the current selection or region. */
export function SelectionToolbar({
  placement,
  onHighlight,
  onComment,
  onVoice,
}: SelectionToolbarProps) {
  return (
    <div
      className="selection-toolbar"
      role="toolbar"
      aria-label="Selection actions"
      style={{ left: placement.left, top: placement.top }}
      // Keep the selection: a pointerdown on the toolbar must not collapse it.
      onPointerDown={(e) => e.preventDefault()}
    >
      <button type="button" onClick={onHighlight}>
        Highlight
      </button>
      <button type="button" onClick={onComment}>
        Comment
      </button>
      <button type="button" onClick={onVoice} aria-label="Voice comment">
        🎤 Voice
      </button>
    </div>
  )
}
