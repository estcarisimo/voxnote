import { describe, expect, it, vi } from 'vitest'
import {
  formatBytes,
  readStorageStatus,
  requestPersistence,
  type StorageApi,
} from './storagePersistence'

const NOW = new Date('2026-11-08T01:00:00Z')

function api(granted: boolean, persisted = granted): StorageApi {
  return {
    persist: vi.fn(async () => granted),
    persisted: vi.fn(async () => persisted),
    estimate: vi.fn(async () => ({ usage: 1_234_567, quota: 10e9 })),
  }
}

describe('requestPersistence', () => {
  it('reports a granted request with the usage estimate', async () => {
    const storage = api(true)
    expect(await requestPersistence(storage, NOW)).toEqual({
      persistence: 'granted',
      usage: 1_234_567,
      quota: 10e9,
      requested: true,
      checkedAt: '2026-11-08T01:00:00.000Z',
    })
    expect(storage.persist).toHaveBeenCalledTimes(1)
  })

  it('reports a refused request as denied', async () => {
    expect((await requestPersistence(api(false), NOW)).persistence).toBe(
      'denied',
    )
  })

  it('reports a browser without the API as unavailable, not as denied', async () => {
    expect(await requestPersistence(undefined, NOW)).toEqual({
      persistence: 'unavailable',
      usage: null,
      quota: null,
      requested: true,
      checkedAt: '2026-11-08T01:00:00.000Z',
    })
    expect(
      (await requestPersistence({ estimate: api(true).estimate }, NOW))
        .persistence,
    ).toBe('unavailable')
  })

  it('surfaces a failing persist() instead of guessing', async () => {
    await expect(
      requestPersistence(
        {
          persist: () => Promise.reject(new Error('SecurityError')),
        },
        NOW,
      ),
    ).rejects.toThrow('SecurityError')
  })
})

describe('readStorageStatus', () => {
  it('checks the mode without requesting persistence', async () => {
    const storage = api(true, false)
    const status = await readStorageStatus(storage, NOW)
    expect(status.persistence).toBe('denied')
    expect(status.requested).toBe(false)
    expect(storage.persist).not.toHaveBeenCalled()
  })

  it('keeps an unknown estimate as null', async () => {
    const { estimate: _estimate, ...noEstimate } = api(true)
    const status = await readStorageStatus(noEstimate, NOW)
    expect(status).toMatchObject({
      persistence: 'granted',
      usage: null,
      quota: null,
    })
  })
})

describe('formatBytes', () => {
  it('uses decimal units', () => {
    expect(formatBytes(12)).toBe('12 B')
    expect(formatBytes(1_234_567)).toBe('1.2 MB')
    expect(formatBytes(340_000)).toBe('340 kB')
    expect(formatBytes(10e9)).toBe('10.0 GB')
  })
})
