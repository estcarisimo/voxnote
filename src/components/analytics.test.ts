import { afterEach, describe, expect, it, vi } from 'vitest'
import { GTAG_SCRIPT_ATTRIBUTE, loadAnalytics } from './analytics'

function scripts() {
  return document.querySelectorAll(`script[${GTAG_SCRIPT_ATTRIBUTE}]`)
}

function queued(): unknown[][] {
  return (window.dataLayer ?? []).map((call) =>
    Array.from(call as ArrayLike<unknown>),
  )
}

describe('loadAnalytics', () => {
  afterEach(() => {
    for (const script of scripts()) script.remove()
    delete window.dataLayer
    vi.unstubAllGlobals()
  })

  it('loads nothing and makes no request when the id is unset', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(loadAnalytics(undefined)).toBe(false)
    expect(loadAnalytics('')).toBe(false)
    expect(scripts()).toHaveLength(0)
    expect(window.dataLayer).toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('injects the script and denies storage before the config call', () => {
    expect(loadAnalytics('G-TEST123')).toBe(true)
    const tags = scripts()
    expect(tags).toHaveLength(1)
    const script = tags[0] as HTMLScriptElement
    expect(script.src).toBe(
      'https://www.googletagmanager.com/gtag/js?id=G-TEST123',
    )
    expect(script.async).toBe(true)

    const calls = queued()
    expect(calls[0]).toEqual([
      'consent',
      'default',
      { analytics_storage: 'denied', ad_storage: 'denied' },
    ])
    expect(calls[1]?.[0]).toBe('js')
    expect(calls[2]).toEqual(['config', 'G-TEST123', { send_page_view: true }])
    expect(calls).toHaveLength(3)
  })

  it('loads the script only once', () => {
    expect(loadAnalytics('G-TEST123')).toBe(true)
    expect(loadAnalytics('G-TEST123')).toBe(false)
    expect(scripts()).toHaveLength(1)
    expect(queued()).toHaveLength(3)
  })
})
