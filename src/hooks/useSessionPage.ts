import { useEffect, useRef } from 'react'
import type { RecoveryStore } from '../core/recoveryStore'

/** How often scrolling may rewrite the session record. */
export const SESSION_PAGE_THROTTLE_MS = 1000

/**
 * The page at the top of the visible area: the first `[data-page-number]`
 * element whose bottom is below the container's upper third.
 */
export function visiblePage(
  root: ParentNode,
  viewport: DOMRect,
): number | null {
  const line = viewport.top + viewport.height / 3
  for (const element of root.querySelectorAll<HTMLElement>(
    '[data-page-number]',
  )) {
    if (element.getBoundingClientRect().bottom > line) {
      const page = Number(element.dataset.pageNumber)
      return Number.isInteger(page) && page >= 1 ? page : null
    }
  }
  return null
}

/**
 * Records which page of the open PDF is in view, so Resume returns to it:
 * at most once per {@link SESSION_PAGE_THROTTLE_MS} while scrolling, and
 * once more when the page is hidden. `documentId` is null when no PDF is
 * open. Failed writes are reported through `onError`.
 */
export function useSessionPage(
  store: RecoveryStore | null,
  documentId: string | null,
  onError: (message: string) => void,
): void {
  const report = useRef(onError)
  useEffect(() => {
    report.current = onError
  })

  useEffect(() => {
    if (!store || !documentId) return
    let last: number | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let live = true

    const record = () => {
      timer = undefined
      const scroller = document.querySelector('.pdf-viewer')
      if (!scroller) return
      const page = visiblePage(scroller, scroller.getBoundingClientRect())
      if (page === null || page === last) return
      last = page
      store
        .putSession({ documentId, page, updatedAt: new Date().toISOString() })
        .catch((err: unknown) => {
          if (live) {
            report.current(
              `Could not record the page in view: ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        })
    }
    const onScroll = () => {
      if (timer === undefined) {
        timer = setTimeout(record, SESSION_PAGE_THROTTLE_MS)
      }
    }
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return
      clearTimeout(timer)
      record()
    }
    // Scroll does not bubble; capture sees the viewer's own scrolling.
    document.addEventListener('scroll', onScroll, true)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      live = false
      clearTimeout(timer)
      document.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [store, documentId])
}
