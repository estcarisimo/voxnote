import { useEffect, useState, type RefObject } from 'react'

/** The attribute every page element carries, with its 1-based number. */
export const PAGE_ATTRIBUTE = 'data-page-number'

/**
 * Tracks which pages are within `margin` of the scroll container's viewport,
 * as an IntersectionObserver rootMargin (for example '100% 0px': one screen
 * above and one below). Only these pages need a canvas and a text layer;
 * the others can stay empty boxes of the right size.
 *
 * Page elements are found as the container's descendants with
 * `data-page-number`, once `count` of them exist.
 */
export function useNearPages(
  containerRef: RefObject<HTMLElement | null>,
  count: number,
  margin: string,
): ReadonlySet<number> {
  const [near, setNear] = useState<ReadonlySet<number>>(() => new Set())

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    if (typeof IntersectionObserver === 'undefined') {
      throw new Error(
        'This browser lacks IntersectionObserver, which page rendering needs',
      )
    }
    const observer = new IntersectionObserver(
      (entries) => {
        setNear((previous) => {
          const next = new Set(previous)
          for (const entry of entries) {
            const page = Number(entry.target.getAttribute(PAGE_ATTRIBUTE))
            if (entry.isIntersecting) next.add(page)
            else next.delete(page)
          }
          return sameMembers(previous, next) ? previous : next
        })
      },
      { root: container, rootMargin: margin },
    )
    const pages = container.querySelectorAll(`[${PAGE_ATTRIBUTE}]`)
    if (pages.length !== count) {
      throw new Error(`Expected ${count} page elements, found ${pages.length}`)
    }
    for (const page of pages) observer.observe(page)
    return () => {
      observer.disconnect()
      setNear(new Set())
    }
  }, [containerRef, count, margin])

  return near
}

function sameMembers(a: ReadonlySet<number>, b: ReadonlySet<number>) {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}
