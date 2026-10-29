import { useEffect, type RefObject } from 'react'

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

/**
 * Keeps keyboard focus inside a modal dialog: moves focus into it on mount,
 * cycles Tab within it, closes on Escape, and restores focus afterwards.
 */
export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  onEscape: () => void,
): void {
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const previous = document.activeElement as HTMLElement | null
    const focusable = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
    const initial = focusable()[0]
    if (initial) initial.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onEscape()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [ref, onEscape])
}
