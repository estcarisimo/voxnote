import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HIGHLIGHT_COLOR_KEY, useHighlightColor } from './useHighlightColor'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('useHighlightColor', () => {
  it('starts yellow and remembers the pick in localStorage', () => {
    const { result } = renderHook(() => useHighlightColor())
    expect(result.current.color).toBe('yellow')
    act(() => result.current.setColor('green'))
    expect(result.current.color).toBe('green')
    expect(localStorage.getItem(HIGHLIGHT_COLOR_KEY)).toBe('green')
    expect(result.current.error).toBeNull()

    const { result: again } = renderHook(() => useHighlightColor())
    expect(again.current.color).toBe('green')
  })

  it('throws on a stored value outside the palette instead of guessing', () => {
    localStorage.setItem(HIGHLIGHT_COLOR_KEY, 'magenta')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useHighlightColor())).toThrow(
      /"magenta" is not in the palette/,
    )
  })

  it('keeps the color for the session and reports when it cannot be saved', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const { result } = renderHook(() => useHighlightColor())
    act(() => result.current.setColor('pink'))
    expect(result.current.color).toBe('pink')
    expect(result.current.error).toMatch(/could not be remembered.*Quota/)
  })

  it('rejects a color outside the palette', () => {
    const { result } = renderHook(() => useHighlightColor())
    expect(() =>
      act(() => result.current.setColor('red' as unknown as 'pink')),
    ).toThrow(/Unknown highlight color "red"/)
  })
})
