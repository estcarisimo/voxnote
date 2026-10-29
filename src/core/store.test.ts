// @vitest-environment node
// Node, not jsdom: fake-indexeddb clones records with Node's structuredClone,
// which turns a jsdom Blob into an empty object. Browsers have one realm.
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createComment, createHighlight, withBody } from './annotations'
import {
  createAnnotationStore,
  openAnnotationStore,
  openDatabase,
} from './store'

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
      const req = factory.open('test', 2)
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

  it('rejects a write whose transaction aborts after the request succeeded', async () => {
    const db = await openDatabase('test', new IDBFactory())
    // Abort the transaction from inside the request's success handler, as a
    // quota failure at commit time would: the request "succeeds" but the
    // transaction never completes.
    const realTransaction = db.transaction.bind(db)
    db.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
      const tx = realTransaction(...args)
      const realObjectStore = tx.objectStore.bind(tx)
      tx.objectStore = (name: string) => {
        const store = realObjectStore(name)
        const realPut = store.put.bind(store)
        store.put = (...putArgs: Parameters<IDBObjectStore['put']>) => {
          const request = realPut(...putArgs)
          request.addEventListener('success', () => tx.abort())
          return request
        }
        return store
      }
      return tx
    }) as IDBDatabase['transaction']

    const store = createAnnotationStore(db)
    const a = createHighlight({ documentId: 'doc', anchor: region(1) })
    await expect(store.put(a)).rejects.toThrow(/abort/)
    store.close()
  })
})

describe('IndexedDB audio records', () => {
  const voice = {
    mimeType: 'audio/webm;codecs=opus',
    durationMs: 1200,
    recordedAt: '2026-10-29T12:00:00.000Z',
  }

  it('stores a comment with its recording and deletes both together', async () => {
    const store = await openAnnotationStore('test', new IDBFactory())
    const c = createComment({
      documentId: 'doc',
      anchor: region(1),
      body: '',
      voice,
    })
    const blob = new Blob(['fake-opus'], { type: voice.mimeType })
    await store.put(c, { id: c.id, blob })

    expect(await store.list('doc')).toEqual([c])
    const audio = await store.getAudio(c.id)
    expect(audio?.id).toBe(c.id)
    expect(await audio?.blob.text()).toBe('fake-opus')

    // Editing the body must not drop the audio.
    await store.put(withBody(c, 'typed afterwards'))
    expect((await store.getAudio(c.id))?.id).toBe(c.id)

    await store.delete(c.id)
    expect(await store.list('doc')).toEqual([])
    expect(await store.getAudio(c.id)).toBeNull()
    store.close()
  })

  it('refuses audio that does not belong to a voice comment', async () => {
    const store = await openAnnotationStore('test', new IDBFactory())
    const h = createHighlight({ documentId: 'doc', anchor: region(1) })
    const blob = new Blob(['x'], { type: 'audio/webm' })
    await expect(store.put(h, { id: h.id, blob })).rejects.toThrow(
      /no voice note/,
    )
    const c = createComment({
      documentId: 'doc',
      anchor: region(1),
      body: '',
      voice,
    })
    await expect(store.put(c, { id: 'other', blob })).rejects.toThrow(
      /does not match/,
    )
    await expect(
      store.put(c, { id: c.id, blob: new Blob([], { type: 'audio/webm' }) }),
    ).rejects.toThrow(/empty audio/)
    expect(await store.list('doc')).toEqual([])
    store.close()
  })

  it('upgrades a version 1 database without losing annotations', async () => {
    const factory = new IDBFactory()
    const h = createHighlight({ documentId: 'doc', anchor: region(1) })
    await new Promise<void>((resolve, reject) => {
      const req = factory.open('test', 1)
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore('annotations', { keyPath: 'id' })
        s.createIndex('documentId', 'documentId', { unique: false })
      }
      req.onsuccess = () => {
        const tx = req.result.transaction('annotations', 'readwrite')
        tx.objectStore('annotations').put(h)
        tx.oncomplete = () => {
          req.result.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })

    const store = await openAnnotationStore('test', factory)
    expect(await store.list('doc')).toEqual([h])
    expect(await store.getAudio(h.id)).toBeNull()
    store.close()
  })
})
