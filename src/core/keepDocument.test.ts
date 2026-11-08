// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { memoryRecoveryStore } from '../test/memoryRecoveryStore'
import { NO_PERSIST_API, keepOpenedDocument } from './keepDocument'
import type { StorageStatus } from './storagePersistence'

const ID = 'a'.repeat(64)
const NOW = () => new Date('2026-11-08T01:00:00Z')
const input = {
  id: ID,
  name: 'paper.pdf',
  mimeType: 'application/pdf',
  bytes: new Uint8Array([37, 80, 68, 70]),
  page: 1,
}

function status(persistence: StorageStatus['persistence']): StorageStatus {
  return {
    persistence,
    usage: null,
    quota: null,
    requested: true,
    checkedAt: '2026-11-08T01:00:00.000Z',
  }
}

function effects(overrides = {}) {
  return {
    store: memoryRecoveryStore(),
    isStillOpen: () => true,
    ensurePersistent: vi.fn(async () => status('granted')),
    onKept: vi.fn(),
    onError: vi.fn(),
    now: NOW,
    ...overrides,
  }
}

describe('keepOpenedDocument', () => {
  it('keeps the bytes and names the document in the session', async () => {
    const e = effects()
    await keepOpenedDocument(input, e)
    expect(e.store.documents.get(ID)).toMatchObject({
      name: 'paper.pdf',
      size: 4,
      openedAt: '2026-11-08T01:00:00.000Z',
    })
    expect(e.store.session).toEqual({
      documentId: ID,
      page: 1,
      updatedAt: '2026-11-08T01:00:00.000Z',
    })
    expect(e.onKept).toHaveBeenCalledWith(ID)
    expect(e.ensurePersistent).toHaveBeenCalledTimes(1)
    expect(e.onError).not.toHaveBeenCalled()
  })

  it('writes the session without waiting for a persistence prompt', async () => {
    // Firefox asks the user; the answer may never come.
    const e = effects({ ensurePersistent: vi.fn(() => new Promise(() => {})) })
    await keepOpenedDocument(input, e)
    expect(e.store.session?.documentId).toBe(ID)
  })

  it('does not put back a session that Close cleared meanwhile', async () => {
    const e = effects({ isStillOpen: () => false })
    await keepOpenedDocument(input, e)
    expect(e.store.session).toBeNull()
    expect(e.onKept).not.toHaveBeenCalled()
  })

  it('reports a failed copy and clears the previous session', async () => {
    const e = effects()
    e.store.session = {
      documentId: 'b'.repeat(64),
      page: 3,
      updatedAt: '2026-11-07T00:00:00Z',
    }
    e.store.putDocument = () => Promise.reject(new Error('QuotaExceededError'))
    await keepOpenedDocument(input, e)
    expect(e.onError).toHaveBeenCalledWith(
      expect.stringContaining(
        'a copy could not be kept on this device (QuotaExceededError)',
      ),
    )
    expect(e.store.session).toBeNull()
    expect(e.ensurePersistent).not.toHaveBeenCalled()
  })

  it('reports a browser without the persistence API, and a failed request', async () => {
    const none = effects({
      ensurePersistent: vi.fn(async () => status('unavailable')),
    })
    await keepOpenedDocument(input, none)
    await vi.waitFor(() =>
      expect(none.onError).toHaveBeenCalledWith(NO_PERSIST_API),
    )
    const failing = effects({
      ensurePersistent: vi.fn(() => Promise.reject(new Error('SecurityError'))),
    })
    await keepOpenedDocument(input, failing)
    await vi.waitFor(() =>
      expect(failing.onError).toHaveBeenCalledWith(
        'Could not request persistent storage: SecurityError',
      ),
    )
  })
})
