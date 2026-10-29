import './SelectionToolbar.css'

export interface ToolbarPlacement {
  /** Horizontal center, in the scroll container's content coordinates. */
  left: number
  /** Top edge of the selection; the toolbar sits above it. */
  top: number
}

interface SelectionToolbarProps {
  placement: ToolbarPlacement
  onHighlight: () => void
}

/** Floating actions for the current text selection. */
export function SelectionToolbar({
  placement,
  onHighlight,
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
    </div>
  )
}
