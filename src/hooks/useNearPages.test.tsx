import { act, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PAGE_ATTRIBUTE, useNearPages } from './useNearPages'

type Callback = (entries: Partial<IntersectionObserverEntry>[]) => void

// jsdom has no IntersectionObserver: this one records what it was given and
// lets the test report intersections.
let observers: FakeObserver[] = []
class FakeObserver {
  observed: Element[] = []
  disconnected = false
  callback: Callback
  options: IntersectionObserverInit
  constructor(callback: Callback, options: IntersectionObserverInit) {
    this.callback = callback
    this.options = options
    observers.push(this)
  }
  observe(element: Element) {
    this.observed.push(element)
  }
  disconnect() {
    this.disconnected = true
  }
  report(changes: Record<number, boolean>) {
    act(() =>
      this.callback(
        Object.entries(changes).map(([page, isIntersecting]) => ({
          target: this.observed[Number(page) - 1],
          isIntersecting,
        })),
      ),
    )
  }
}

beforeEach(() => {
  observers = []
  vi.stubGlobal('IntersectionObserver', FakeObserver)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function Pages({
  count,
  rendered = count,
}: {
  count: number
  rendered?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const near = useNearPages(ref, count, '100% 0px')
  return (
    <div ref={ref} data-testid="root">
      <output>{[...near].sort((a, b) => a - b).join(',')}</output>
      {Array.from({ length: rendered }, (_, i) => (
        <div key={i} {...{ [PAGE_ATTRIBUTE]: i + 1 }} />
      ))}
    </div>
  )
}

const near = () => screen.getByRole('status').textContent

describe('useNearPages', () => {
  it('observes every page against the scroll container with the margin', () => {
    render(<Pages count={3} />)
    expect(observers).toHaveLength(1)
    const [observer] = observers
    expect(observer.options.root).toBe(screen.getByTestId('root'))
    expect(observer.options.rootMargin).toBe('100% 0px')
    expect(
      observer.observed.map((e) => e.getAttribute(PAGE_ATTRIBUTE)),
    ).toEqual(['1', '2', '3'])
    expect(near()).toBe('')
  })

  it('adds pages that come near and drops pages that go far', () => {
    render(<Pages count={5} />)
    const [observer] = observers
    observer.report({ 1: true, 2: true })
    expect(near()).toBe('1,2')
    observer.report({ 1: false, 3: true })
    expect(near()).toBe('2,3')
  })

  it('keeps the same set object when an update changes nothing', () => {
    const renders = vi.fn()
    function Probe() {
      const ref = useRef<HTMLDivElement>(null)
      const set = useNearPages(ref, 1, '0px')
      renders(set)
      return (
        <div ref={ref}>
          <div {...{ [PAGE_ATTRIBUTE]: 1 }} />
        </div>
      )
    }
    render(<Probe />)
    const [observer] = observers
    observer.report({ 1: true })
    const before = renders.mock.calls.at(-1)?.[0]
    expect([...before]).toEqual([1])
    observer.report({ 1: true })
    // The same object: pages that read it see no change.
    expect(renders.mock.calls.at(-1)?.[0]).toBe(before)
  })

  it('disconnects on unmount', () => {
    const { unmount } = render(<Pages count={2} />)
    unmount()
    expect(observers[0].disconnected).toBe(true)
  })

  it('fails loudly when the page elements do not match the count', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Pages count={3} rendered={2} />)).toThrow(
      'Expected 3 page elements, found 2',
    )
  })

  it('fails loudly without IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Pages count={1} />)).toThrow(/IntersectionObserver/)
  })
})
