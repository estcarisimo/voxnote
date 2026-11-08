// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { StorageApi } from '../core/storagePersistence'
import { useStorageStatus } from './useStorageStatus'

function api(grant: boolean, persisted = false) {
  return {
    persist: vi.fn(async () => grant),
    persisted: vi.fn(async () => persisted),
    estimate: vi.fn(async () => ({ usage: 2000, quota: 1e9 })),
  } satisfies StorageApi
}

describe('useStorageStatus', () => {
  it('requests persistence once per page load and keeps the outcome', async () => {
    const storage = api(true)
    const { result } = renderHook(() => useStorageStatus(storage))
    expect(result.current.status).toBeNull()
    await act(async () => {
      await result.current.ensurePersistent()
      await result.current.ensurePersistent()
    })
    expect(storage.persist).toHaveBeenCalledTimes(1)
    expect(result.current.status).toMatchObject({
      persistence: 'granted',
      usage: 2000,
      requested: true,
    })
    // A later check keeps showing that it was asked for.
    await act(async () => {
      storage.persisted.mockResolvedValue(true)
      await result.current.refresh()
    })
    expect(result.current.status).toMatchObject({
      persistence: 'granted',
      requested: true,
    })
  })

  it('does not ask again when the origin is already persistent', async () => {
    const storage = api(true, true)
    const { result } = renderHook(() => useStorageStatus(storage))
    await act(async () => {
      await result.current.ensurePersistent()
    })
    expect(storage.persist).not.toHaveBeenCalled()
    expect(result.current.status?.persistence).toBe('granted')
  })

  it('reports a refusal and a missing API as such', async () => {
    const refused = renderHook(() => useStorageStatus(api(false)))
    await act(async () => {
      await refused.result.current.ensurePersistent()
    })
    expect(refused.result.current.status?.persistence).toBe('denied')

    const none = renderHook(() => useStorageStatus(undefined))
    await act(async () => {
      await none.result.current.ensurePersistent()
    })
    expect(none.result.current.status?.persistence).toBe('unavailable')
  })
})
