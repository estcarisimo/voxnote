// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Draft } from '../core/recoveryStore'
import { memoryRecoveryStore } from '../test/memoryRecoveryStore'
import { DRAFT_DEBOUNCE_MS, useDraft } from './useDraft'

const DOC = 'a'.repeat(64)
const anchor = {
  type: 'region',
  page: 1,
  rect: { x: 0, y: 0, width: 5, height: 5 },
} as const
const placement = { left: 1, top: 2, bottom: 3 }

const settle = () => act(async () => {})

describe('useDraft', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes the draft after typing pauses, and deletes it on remove', async () => {
    const store = memoryRecoveryStore()
    const { result } = renderHook(() => useDraft(DOC, { store, error: null }))
    await settle()
    expect(result.current.ready).toBe(true)
    expect(result.current.restored).toBeNull()

    act(() =>
      result.current.begin({ mode: 'typed', anchor, placement, body: '' }),
    )
    act(() => result.current.update({ body: 'Half a' }))
    act(() => result.current.update({ body: 'Half a thought' }))
    expect(store.drafts.size).toBe(0)
    await act(async () => {
      vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS)
    })
    expect(store.drafts.get(DOC)).toMatchObject({
      documentId: DOC,
      mode: 'typed',
      body: 'Half a thought',
    })
    expect(store.drafts.get(DOC)?.updatedAt).toMatch(/Z$/)

    act(() => result.current.remove())
    await settle()
    expect(store.drafts.size).toBe(0)
  })

  it('does not keep an empty composer', async () => {
    const store = memoryRecoveryStore()
    const { result } = renderHook(() => useDraft(DOC, { store, error: null }))
    await settle()
    act(() =>
      result.current.begin({ mode: 'typed', anchor, placement, body: '' }),
    )
    await act(async () => {
      vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS)
    })
    expect(store.drafts.size).toBe(0)
  })

  it('writes at once when the page is hidden or the document closes', async () => {
    const store = memoryRecoveryStore()
    const { result, rerender } = renderHook(
      ({ id }) => useDraft(id, { store, error: null }),
      { initialProps: { id: DOC as string | null } },
    )
    await settle()
    act(() =>
      result.current.begin({ mode: 'typed', anchor, placement, body: 'a' }),
    )
    window.dispatchEvent(new Event('pagehide'))
    await settle()
    expect(store.drafts.get(DOC)?.body).toBe('a')

    act(() => result.current.update({ body: 'ab' }))
    rerender({ id: null })
    await settle()
    // Closing keeps the draft, written in its latest state.
    expect(store.drafts.get(DOC)?.body).toBe('ab')
  })

  it('restores the stored draft and keeps updating it', async () => {
    const store = memoryRecoveryStore()
    const kept: Draft = {
      documentId: DOC,
      mode: 'typed',
      anchor,
      placement,
      body: 'before the crash',
      updatedAt: '2026-11-07T10:00:00.000Z',
    }
    store.drafts.set(DOC, kept)
    const { result } = renderHook(() => useDraft(DOC, { store, error: null }))
    expect(result.current.ready).toBe(false)
    await settle()
    expect(result.current.restored).toEqual(kept)
    act(() => result.current.update({ body: 'before the crash, and after' }))
    await act(async () => {
      vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS)
    })
    expect(store.drafts.get(DOC)).toMatchObject({
      mode: 'typed',
      body: 'before the crash, and after',
    })
  })

  it('removes a field when the patch sets it to undefined', async () => {
    const store = memoryRecoveryStore()
    const { result } = renderHook(() => useDraft(DOC, { store, error: null }))
    await settle()
    const audio = {
      blob: new Blob(['a']),
      mimeType: 'audio/webm',
      durationMs: 5,
      recordedAt: '2026-11-07T10:00:00.000Z',
      complete: true,
    }
    act(() =>
      result.current.begin({ mode: 'voice', anchor, placement, body: '' }),
    )
    act(() => result.current.update({ audio }))
    await act(async () => {
      vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS)
    })
    expect(store.drafts.get(DOC)?.audio).toBe(audio)
    act(() => result.current.update({ audio: undefined }))
    await act(async () => {
      vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS)
    })
    // Nothing left worth keeping: the stored draft is deleted.
    expect(store.drafts.has(DOC)).toBe(false)
  })

  it('reports a failed write instead of swallowing it', async () => {
    const store = memoryRecoveryStore()
    const { result } = renderHook(() => useDraft(DOC, { store, error: null }))
    await settle()
    store.fail = new Error('QuotaExceededError')
    act(() =>
      result.current.begin({ mode: 'typed', anchor, placement, body: 'x' }),
    )
    await act(async () => {
      vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS)
    })
    await settle()
    expect(result.current.error).toBe(
      'Could not keep the draft on this device: QuotaExceededError',
    )
  })

  it('is ready without a store when the store failed to open', () => {
    const { result } = renderHook(() =>
      useDraft(DOC, { store: null, error: 'no IndexedDB' }),
    )
    expect(result.current.ready).toBe(true)
    expect(result.current.restored).toBeNull()
  })
})
