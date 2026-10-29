import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createHighlight } from './annotations'
import { openAnnotationStore } from './store'

const region = (page: number) =>
  ({
    type: 'region',
    page,
    rect: { x: 0, y: 0, width: 10, height: 10 },
  }) as const

describe('IndexedDB annotation store', () => {
  it('round-trips annotations per document, oldest first', async () => {
    const store = await openAnnotationStore('test', new IDBFactory())
    const a = createHighlight(
      { documentId: 'doc-a', anchor: region(1) },
      new Date('2026-01-01T00:00:02Z'),
    )
    const b = createHighlight(
      { documentId: 'doc-a', anchor: region(2) },
      new Date('2026-01-01T00:00:01Z'),
    )
    const c = createHighlight({ documentId: 'doc-b', anchor: region(1) })
    await store.put(a)
    await store.put(b)
    await store.put(c)

    expect((await store.list('doc-a')).map((x) => x.id)).toEqual([b.id, a.id])
    expect(await store.list('doc-b')).toEqual([c])
    expect(await store.list('doc-none')).toEqual([])

    await store.delete(a.id)
    expect(await store.list('doc-a')).toEqual([b])
    store.close()
  })

  it('refuses to store an invalid record', async () => {
    const store = await openAnnotationStore('test', new IDBFactory())
    const a = createHighlight({ documentId: 'doc', anchor: region(1) })
    await expect(store.put({ ...a, kind: 'nope' as never })).rejects.toThrow(
      /invalid annotation/,
    )
    store.close()
  })

  it('fails loudly on a corrupt record instead of skipping it', async () => {
    const factory = new IDBFactory()
    const store = await openAnnotationStore('test', factory)
    // Write a bad record behind the store's back.
    await new Promise<void>((resolve, reject) => {
      const req = factory.open('test', 1)
      req.onsuccess = () => {
        const tx = req.result.transaction('annotations', 'readwrite')
        tx.objectStore('annotations').put({
          id: 'x',
          documentId: 'doc',
          schemaVersion: 99,
        })
        tx.oncomplete = () => {
          req.result.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
    await expect(store.list('doc')).rejects.toThrow(/Corrupt annotation record/)
    store.close()
  })
})
