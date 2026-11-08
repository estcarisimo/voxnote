// @vitest-environment node
// Node, not jsdom: fake-indexeddb clones records with Node's structuredClone,
// which turns a jsdom Blob into an empty object. Browsers have one realm.
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import {
  createComment,
  createHighlight,
  createSuggestion,
  withBody,
} from './annotations'
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

  it('reads schema v1 and v2 records as v3, highlights in the default color', async () => {
    const factory = new IDBFactory()
    const store = await openAnnotationStore('test', factory)
    const highlight = createHighlight(
      { documentId: 'doc', anchor: region(1) },
      new Date('2026-01-01T00:00:01Z'),
    )
    const comment = createComment(
      { documentId: 'doc', anchor: region(2), body: 'Why?' },
      new Date('2026-01-01T00:00:02Z'),
    )
    // Stored before v3: no color on the highlight, old version numbers.
    const { color: _color, ...colorless } = highlight
    const stored = [
      { ...colorless, schemaVersion: 1 },
      { ...comment, schemaVersion: 2 },
    ]
    await new Promise<void>((resolve, reject) => {
      const req = factory.open('test')
      req.onsuccess = () => {
        const tx = req.result.transaction('annotations', 'readwrite')
        for (const record of stored) tx.objectStore('annotations').put(record)
        tx.oncomplete = () => {
          req.result.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
    expect(await store.list('doc')).toEqual([
      { ...highlight, color: 'yellow' },
      comment,
    ])
    store.close()
  })

  it('fails loudly on a corrupt record instead of skipping it', async () => {
    const factory = new IDBFactory()
    const store = await openAnnotationStore('test', factory)
    // Write a bad record behind the store's back.
    await new Promise<void>((resolve, reject) => {
      const req = factory.open('test')
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

  it('stores a dictated suggestion with its recording', async () => {
    const store = await openAnnotationStore('test', new IDBFactory())
    const s = createSuggestion({
      documentId: 'doc',
      anchor: {
        type: 'text',
        page: 1,
        quote: 'teh',
        rects: [{ x: 0, y: 0, width: 10, height: 10 }],
      },
      body: '',
      voice,
    })
    await store.put(s, { id: s.id, blob: new Blob(['opus']) })
    expect(await store.list('doc')).toEqual([s])
    expect((await store.getAudio(s.id))?.id).toBe(s.id)
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

describe('IndexedDB write atomicity with audio', () => {
  const voice = {
    mimeType: 'audio/webm;codecs=opus',
    durationMs: 1200,
    recordedAt: '2026-10-29T12:00:00.000Z',
  }
  const blob = () => new Blob(['opus'], { type: voice.mimeType })

  /** Patches `put` on the named object store of every transaction. */
  function patchPut(
    db: IDBDatabase,
    storeName: string,
    patch: (
      realPut: IDBObjectStore['put'],
      tx: IDBTransaction,
    ) => IDBObjectStore['put'],
  ) {
    const realTransaction = db.transaction.bind(db)
    db.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
      const tx = realTransaction(...args)
      const realObjectStore = tx.objectStore.bind(tx)
      tx.objectStore = (name: string) => {
        const store = realObjectStore(name)
        if (name === storeName) store.put = patch(store.put.bind(store), tx)
        return store
      }
      return tx
    }) as IDBDatabase['transaction']
  }

  it('rolls back the audio row when the annotation request throws synchronously', async () => {
    const db = await openDatabase('test', new IDBFactory())
    patchPut(db, 'annotations', () => () => {
      throw new DOMException('simulated DataCloneError', 'DataCloneError')
    })
    const store = createAnnotationStore(db)
    const c = createComment({
      documentId: 'doc',
      anchor: region(1),
      body: '',
      voice,
    })
    await expect(store.put(c, { id: c.id, blob: blob() })).rejects.toThrow(
      /simulated DataCloneError/,
    )
    expect(await store.getAudio(c.id)).toBeNull()
    expect(await store.list('doc')).toEqual([])
    store.close()
  })

  it('rolls back the annotation when the audio write fails at commit', async () => {
    const db = await openDatabase('test', new IDBFactory())
    patchPut(db, 'audio', (realPut, tx) => (...args) => {
      const request = realPut(...args)
      request.addEventListener('success', () => tx.abort())
      return request
    })
    const store = createAnnotationStore(db)
    const c = createComment({
      documentId: 'doc',
      anchor: region(1),
      body: 'text too',
      voice,
    })
    await expect(store.put(c, { id: c.id, blob: blob() })).rejects.toThrow(
      /abort/,
    )
    expect(await store.list('doc')).toEqual([])
    expect(await store.getAudio(c.id)).toBeNull()
    store.close()
  })

  it('fails loudly on a corrupt audio record', async () => {
    const factory = new IDBFactory()
    const store = await openAnnotationStore('test', factory)
    await new Promise<void>((resolve, reject) => {
      const req = factory.open('test')
      req.onsuccess = () => {
        const tx = req.result.transaction('audio', 'readwrite')
        tx.objectStore('audio').put({ id: 'x', blob: 'not a blob' })
        tx.oncomplete = () => {
          req.result.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
    await expect(store.getAudio('x')).rejects.toThrow(/Corrupt audio record/)
    store.close()
  })
})

describe('IndexedDB document meta', () => {
  const pdf = { name: 'paper.pdf', kind: 'pdf' } as const
  const clock = (...isos: string[]) => {
    let i = 0
    return () => new Date(isos[Math.min(i++, isos.length - 1)])
  }

  it('records the name and last write time, and lists documents with annotations', async () => {
    const store = await openAnnotationStore(
      'test',
      new IDBFactory(),
      clock(
        '2026-11-01T10:00:00Z',
        '2026-11-02T10:00:00Z',
        '2026-11-03T10:00:00Z',
      ),
    )
    const a = createHighlight({ documentId: 'doc-a', anchor: region(1) })
    const b = createHighlight({ documentId: 'doc-b', anchor: region(1) })
    await store.put(a, undefined, pdf)
    await store.put(b, undefined, { name: 'notes.md', kind: 'markdown' })
    // A later write without a label keeps the name and moves the time.
    await store.put(rewritten(a))
    expect(await store.listDocuments()).toEqual([
      {
        id: 'doc-a',
        name: 'paper.pdf',
        kind: 'pdf',
        lastAnnotatedAt: '2026-11-03T10:00:00.000Z',
        count: 1,
      },
      {
        id: 'doc-b',
        name: 'notes.md',
        kind: 'markdown',
        lastAnnotatedAt: '2026-11-02T10:00:00.000Z',
        count: 1,
      },
    ])
    // A document whose last annotation was deleted is not listed.
    await store.delete(b.id)
    expect((await store.listDocuments()).map((d) => d.id)).toEqual(['doc-a'])
    store.close()
  })

  it('writes a batch all or nothing, for one document only', async () => {
    const store = await openAnnotationStore('test', new IDBFactory())
    const a = createHighlight({ documentId: 'doc', anchor: region(1) })
    const b = createHighlight({ documentId: 'doc', anchor: region(2) })
    const other = createHighlight({ documentId: 'other', anchor: region(1) })
    await expect(
      store.putMany([a, { ...b, kind: 'nope' as never }], pdf),
    ).rejects.toThrow(/invalid annotation/)
    await expect(store.putMany([a, other], pdf)).rejects.toThrow(
      /belongs to document other/,
    )
    expect(await store.list('doc')).toEqual([])
    expect(await store.listDocuments()).toEqual([])

    await store.putMany([a, b], pdf)
    expect(await store.list('doc')).toHaveLength(2)
    expect(await store.listDocuments()).toMatchObject([
      { id: 'doc', name: 'paper.pdf', count: 2 },
    ])
    store.close()
  })

  it('backfills unnamed records when upgrading a version 2 database, then names them on open', async () => {
    const factory = new IDBFactory()
    const older = createHighlight(
      { documentId: 'doc', anchor: region(1) },
      new Date('2026-10-01T00:00:00Z'),
    )
    const newer = createHighlight(
      { documentId: 'doc', anchor: region(2) },
      new Date('2026-10-05T00:00:00Z'),
    )
    await new Promise<void>((resolve, reject) => {
      const req = factory.open('test', 2)
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore('annotations', { keyPath: 'id' })
        s.createIndex('documentId', 'documentId', { unique: false })
        req.result.createObjectStore('audio', { keyPath: 'id' })
      }
      req.onsuccess = () => {
        const tx = req.result.transaction('annotations', 'readwrite')
        tx.objectStore('annotations').put(older)
        tx.objectStore('annotations').put(newer)
        tx.oncomplete = () => {
          req.result.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })

    const store = await openAnnotationStore('test', factory)
    expect(await store.list('doc')).toHaveLength(2)
    expect(await store.listDocuments()).toEqual([
      {
        id: 'doc',
        name: null,
        kind: null,
        lastAnnotatedAt: newer.updatedAt,
        count: 2,
      },
    ])
    await store.nameDocument('doc', pdf)
    // Naming never creates a record for a document with no annotations.
    await store.nameDocument('never-annotated', pdf)
    expect(await store.listDocuments()).toEqual([
      {
        id: 'doc',
        name: 'paper.pdf',
        kind: 'pdf',
        lastAnnotatedAt: newer.updatedAt,
        count: 2,
      },
    ])
    store.close()

    // Opening again is a no-op upgrade: nothing is backfilled twice.
    const again = await openAnnotationStore('test', factory)
    expect(await again.listDocuments()).toHaveLength(1)
    again.close()
  })

  it('fails loudly on a corrupt document record', async () => {
    const factory = new IDBFactory()
    const store = await openAnnotationStore('test', factory)
    await new Promise<void>((resolve, reject) => {
      const req = factory.open('test')
      req.onsuccess = () => {
        const tx = req.result.transaction('documentMeta', 'readwrite')
        tx.objectStore('documentMeta').put({ id: 'x', name: 42 })
        tx.oncomplete = () => {
          req.result.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
    await expect(store.listDocuments()).rejects.toThrow(
      /Corrupt document record/,
    )
    // A write for that document refuses to overwrite what it cannot read.
    const h = createHighlight({ documentId: 'x', anchor: region(1) })
    await expect(store.put(h, undefined, pdf)).rejects.toThrow(/abort/)
    expect(await store.list('x')).toEqual([])
    await expect(store.nameDocument('x', pdf)).rejects.toThrow(/abort/)
    store.close()
  })

  it('refuses an invalid document label', async () => {
    const store = await openAnnotationStore('test', new IDBFactory())
    const h = createHighlight({ documentId: 'doc', anchor: region(1) })
    await expect(
      store.put(h, undefined, { name: '', kind: 'pdf' }),
    ).rejects.toThrow(/Invalid document label/)
    store.close()
  })
})

/** The same highlight, written again (as an edit would). */
function rewritten<T>(value: T): T {
  return { ...value }
}
