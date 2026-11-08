// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { RecoveryStore } from '../core/recoveryStore'
import { memoryRecoveryStore } from '../test/memoryRecoveryStore'
import { useRecoveryStore } from './useRecoveryStore'

describe('useRecoveryStore', () => {
  it('lets a caller wait for a store that is still opening', async () => {
    let finish!: (store: RecoveryStore) => void
    const opening = new Promise<RecoveryStore>((resolve) => (finish = resolve))
    const { result } = renderHook(() => useRecoveryStore(() => opening))
    expect(result.current.store).toBeNull()
    const waited = result.current.whenOpen()
    const store = memoryRecoveryStore()
    await act(async () => finish(store))
    await expect(waited).resolves.toBe(store)
    expect(result.current.store).toBe(store)
    // Once open, it answers at once.
    await expect(result.current.whenOpen()).resolves.toBe(store)
  })

  it('reports a failed open and resolves waiters with null', async () => {
    let fail!: (err: Error) => void
    const opening = new Promise<RecoveryStore>((_, reject) => (fail = reject))
    const { result } = renderHook(() => useRecoveryStore(() => opening))
    const waited = result.current.whenOpen()
    await act(async () => fail(new Error('InvalidStateError')))
    await expect(waited).resolves.toBeNull()
    expect(result.current.error).toContain('Crash recovery is off')
    expect(result.current.error).toContain('InvalidStateError')
  })
})
