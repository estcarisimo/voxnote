// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { describeWindowError, useWindowErrors } from './useWindowErrors'

describe('describeWindowError', () => {
  it('names the error', () => {
    expect(describeWindowError(new Error('boom'), 'x')).toBe(
      'Unexpected error: boom',
    )
    expect(describeWindowError('text', 'x')).toBe('Unexpected error: text')
    expect(describeWindowError(undefined, 'a promise was rejected')).toBe(
      'Unexpected error: a promise was rejected',
    )
  })

  it("ignores Chromium's ResizeObserver scheduling notice", () => {
    expect(
      describeWindowError(
        'ResizeObserver loop completed with undelivered notifications.',
        'x',
      ),
    ).toBeNull()
  })
})

describe('useWindowErrors', () => {
  it('reports uncaught errors and unhandled rejections', () => {
    const onError = vi.fn()
    const { unmount } = renderHook(() => useWindowErrors(onError))
    window.dispatchEvent(
      new ErrorEvent('error', { error: new Error('render failed') }),
    )
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent
    Object.defineProperty(rejection, 'reason', {
      value: new Error('fetch failed'),
    })
    window.dispatchEvent(rejection)
    expect(onError.mock.calls).toEqual([
      ['Unexpected error: render failed'],
      ['Unexpected error: fetch failed'],
    ])
    unmount()
    window.dispatchEvent(new ErrorEvent('error', { message: 'later' }))
    expect(onError).toHaveBeenCalledTimes(2)
  })
})
