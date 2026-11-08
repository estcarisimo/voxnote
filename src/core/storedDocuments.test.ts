// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { memoryRecoveryStore } from '../test/memoryRecoveryStore'
import { storedDocumentsFrom } from './storedDocuments'

describe('storedDocumentsFrom', () => {
  it('lists the kept ids and returns a kept document as a file', async () => {
    const store = memoryRecoveryStore()
    const blob = new Blob(['%PDF-1.4'], { type: 'application/pdf' })
    store.documents.set('a'.repeat(64), {
      id: 'a'.repeat(64),
      name: 'paper.pdf',
      mimeType: 'application/pdf',
      blob,
      size: blob.size,
      openedAt: '2026-11-08T01:00:00Z',
    })
    const stored = storedDocumentsFrom(store)
    expect(await stored.ids()).toEqual(new Set(['a'.repeat(64)]))
    const file = await stored.get('a'.repeat(64))
    expect(file?.name).toBe('paper.pdf')
    expect(file?.type).toBe('application/pdf')
    expect(await file?.text()).toBe('%PDF-1.4')
    expect(await stored.get('b'.repeat(64))).toBeNull()
  })
})
