// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { visiblePage } from './useSessionPage'

function page(n: number, top: number, bottom: number): HTMLElement {
  const element = document.createElement('div')
  element.dataset.pageNumber = String(n)
  element.getBoundingClientRect = () => ({ top, bottom }) as DOMRect
  return element
}

describe('visiblePage', () => {
  const viewport = { top: 0, height: 900 } as DOMRect

  it('is the first page reaching below the upper third of the view', () => {
    const root = document.createElement('div')
    root.append(page(1, -2000, -800), page(2, -790, 250), page(3, 260, 1300))
    expect(visiblePage(root, viewport)).toBe(3)
    root.replaceChildren(page(1, -2000, -800), page(2, -790, 400))
    expect(visiblePage(root, viewport)).toBe(2)
  })

  it('is null without pages', () => {
    expect(visiblePage(document.createElement('div'), viewport)).toBeNull()
  })
})
