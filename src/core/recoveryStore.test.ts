// @vitest-environment node
// Node, not jsdom: fake-indexeddb clones records with Node's structuredClone,
// which turns a jsdom Blob into an empty object. Browsers have one realm.
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createHighlight, type TextAnchor } from './annotations'
import {
  draftHasContent,
  isDraft,
  openRecoveryStore,
  type Draft,
  type StoredDocument,
} from './recoveryStore'
import { DB_VERSION, openAnnotationStore, openDatabase } from './store'

const ID_A = 'a'.repeat(64)
const ID_B = 'b'.repeat(64)

function document(
  id: string,
  openedAt: string,
  bytes = 'pdf',
  name = 'paper.pdf',
): StoredDocument {
  const blob = new Blob([bytes], { type: 'application/pdf' })
  return {
    id,
    name,
    mimeType: 'application/pdf',
    blob,
    size: blob.size,
    openedAt,
  }
}

const textAnchor: TextAnchor = {
  type: 'text',
  page: 2,
  quote: 'the passage',
  rects: [{ x: 1, y: 2, width: 3, height: 4 }],
}

const regionAnchor = {
  type: 'region',
  page: 1,
  rect: { x: 0, y: 0, width: 10, height: 10 },
} as const

function draft(overrides: Partial<Draft> = {}): Draft {
  return {
    documentId: ID_A,
    mode: 'voice',
    anchor: textAnchor,
    placement: { left: 10, top: 20, bottom: 30 },
    body: 'half a thought',
    updatedAt: '2026-11-07T10:00:00.000Z',
    ...overrides,
  }
}

describe('database upgrade', () => {
  it('upgrades a v2 database to v3 without touching its annotations', async () => {
    const factory = new IDBFactory()
    // A v2 database as the previous release created it.
    await new Promise<void>((resolve, reject) => {
      const req = factory.open('test', 2)
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore('annotations', {
          keyPath: 'id',
        })
        store.createIndex('documentId', 'documentId', { unique: false })
        req.result.createObjectStore('audio', { keyPath: 'id' })
      }
      req.onsuccess = () => {
        const highlight = createHighlight({
          documentId: ID_A,
          anchor: regionAnchor,
        })
        const tx = req.result.transaction('annotations', 'readwrite')
        tx.objectStore('annotations').put(highlight)
        tx.oncomplete = () => {
          req.result.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })

    const db = await openDatabase('test', factory)
    expect(db.version).toBe(DB_VERSION)
    expect([...db.objectStoreNames].sort()).toEqual([
      'annotations',
      'audio',
      'documents',
      'drafts',
      'session',
    ])
    db.close()
    const annotations = await openAnnotationStore('test', factory)
    expect(await annotations.list(ID_A)).toHaveLength(1)
    annotations.close()
  })

  it('opens an existing v3 database again without changes', async () => {
    const factory = new IDBFactory()
    const first = await openRecoveryStore('test', factory)
    await first.putSession({
      documentId: ID_A,
      page: 3,
      updatedAt: '2026-11-07T10:00:00Z',
    })
    first.close()
    const second = await openRecoveryStore('test', factory)
    expect(await second.getSession()).toEqual({
      documentId: ID_A,
      page: 3,
      updatedAt: '2026-11-07T10:00:00Z',
    })
    second.close()
  })
})

describe('stored documents', () => {
  it('round-trips the bytes and lists metadata newest first', async () => {
    const store = await openRecoveryStore('test', new IDBFactory())
    await store.putDocument(document(ID_A, '2026-11-07T09:00:00Z', 'aaaa'))
    await store.putDocument(document(ID_B, '2026-11-07T10:00:00Z', 'bb'))

    const a = await store.getDocument(ID_A)
    expect(a?.name).toBe('paper.pdf')
    expect(await a?.blob.text()).toBe('aaaa')
    expect(await store.listDocuments()).toEqual([
      {
        id: ID_B,
        name: 'paper.pdf',
        mimeType: 'application/pdf',
        size: 2,
        openedAt: '2026-11-07T10:00:00Z',
      },
      {
        id: ID_A,
        name: 'paper.pdf',
        mimeType: 'application/pdf',
        size: 4,
        openedAt: '2026-11-07T09:00:00Z',
      },
    ])
    expect(await store.getDocument('c'.repeat(64))).toBeNull()

    await store.deleteDocument(ID_A)
    expect(await store.getDocument(ID_A)).toBeNull()
    store.close()
  })

  it('reopening the same bytes refreshes the name and time only', async () => {
    const store = await openRecoveryStore('test', new IDBFactory())
    await store.putDocument(document(ID_A, '2026-11-07T09:00:00Z', 'aaaa'))
    await store.putDocument(
      document(ID_A, '2026-11-07T11:00:00Z', 'aaaa', 'renamed.pdf'),
    )
    const [summary] = await store.listDocuments()
    expect(summary).toMatchObject({
      name: 'renamed.pdf',
      openedAt: '2026-11-07T11:00:00Z',
    })
    store.close()
  })

  it('refuses an invalid document instead of storing it', async () => {
    const store = await openRecoveryStore('test', new IDBFactory())
    const valid = document(ID_A, '2026-11-07T09:00:00Z')
    await expect(
      store.putDocument({ ...valid, openedAt: '2026-11-07 09:00' }),
    ).rejects.toThrow(/invalid document/)
    await expect(store.putDocument({ ...valid, size: 99 })).rejects.toThrow(
      /invalid document/,
    )
    await expect(store.putDocument({ ...valid, id: 'short' })).rejects.toThrow(
      /invalid document/,
    )
    await expect(
      store.putDocument({ ...valid, blob: new Blob([]), size: 0 }),
    ).rejects.toThrow(/invalid document/)
    expect(await store.listDocuments()).toEqual([])
    store.close()
  })

  it('reports a corrupt record instead of skipping it', async () => {
    const factory = new IDBFactory()
    const db = await openDatabase('test', factory)
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('documents', 'readwrite')
      tx.objectStore('documents').put({ id: ID_A, name: 42 })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
    const store = await openRecoveryStore('test', factory)
    await expect(store.getDocument(ID_A)).rejects.toThrow(/Corrupt/)
    await expect(store.listDocuments()).rejects.toThrow(/Corrupt/)
    store.close()
  })
})

describe('session', () => {
  it('stores one current session and clears it', async () => {
    const store = await openRecoveryStore('test', new IDBFactory())
    expect(await store.getSession()).toBeNull()
    await store.putSession({
      documentId: ID_A,
      page: 1,
      updatedAt: '2026-11-07T10:00:00Z',
    })
    await store.putSession({
      documentId: ID_B,
      page: null,
      updatedAt: '2026-11-07T10:01:00Z',
    })
    expect(await store.getSession()).toEqual({
      documentId: ID_B,
      page: null,
      updatedAt: '2026-11-07T10:01:00Z',
    })
    await store.clearSession()
    expect(await store.getSession()).toBeNull()
    store.close()
  })

  it('refuses a page that is not a positive integer', async () => {
    const store = await openRecoveryStore('test', new IDBFactory())
    await expect(
      store.putSession({
        documentId: ID_A,
        page: 0,
        updatedAt: '2026-11-07T10:00:00Z',
      }),
    ).rejects.toThrow(/invalid session/)
    store.close()
  })
})

describe('drafts', () => {
  it('round-trips a draft with its recording, transcript and polish', async () => {
    const store = await openRecoveryStore('test', new IDBFactory())
    const audio = new Blob(['opus'], { type: 'audio/webm' })
    const full = draft({
      audio: {
        blob: audio,
        mimeType: 'audio/webm',
        durationMs: 4200,
        recordedAt: '2026-11-07T09:59:00.000Z',
        complete: true,
      },
      transcript: {
        raw: 'um so this is wrong',
        provider: 'openai/gpt-4o-transcribe',
        transcribedAt: '2026-11-07T10:00:00.000Z',
      },
      cleanUp: {
        text: 'This is wrong.',
        cleanUp: {
          provider: 'anthropic',
          model: 'claude-opus-5-5',
          createdAt: '2026-11-07T10:00:01.000Z',
          promptVersion: 1,
        },
      },
    })
    await store.putDraft(full)
    const back = await store.getDraft(ID_A)
    expect(back).toMatchObject({ ...full, audio: { durationMs: 4200 } })
    expect(await back?.audio?.blob.text()).toBe('opus')
    expect(await store.getDraft(ID_B)).toBeNull()

    await store.deleteDraft(ID_A)
    expect(await store.getDraft(ID_A)).toBeNull()
    store.close()
  })

  it('keeps one draft per document, the latest', async () => {
    const store = await openRecoveryStore('test', new IDBFactory())
    await store.putDraft(draft({ body: 'first' }))
    await store.putDraft(draft({ body: 'second' }))
    expect((await store.getDraft(ID_A))?.body).toBe('second')
    store.close()
  })

  it('refuses inconsistent drafts', async () => {
    const store = await openRecoveryStore('test', new IDBFactory())
    // A suggestion replaces text, so it needs a quote anchor.
    await expect(
      store.putDraft(draft({ mode: 'suggest', anchor: regionAnchor })),
    ).rejects.toThrow(/invalid draft/)
    await expect(
      store.putDraft(draft({ updatedAt: 'yesterday' })),
    ).rejects.toThrow(/invalid draft/)
    store.close()
  })
})

describe('isDraft', () => {
  const transcript = {
    raw: 'x',
    provider: 'p',
    transcribedAt: '2026-11-07T10:00:00Z',
  }
  const audio = {
    blob: new Blob(['a']),
    mimeType: 'audio/webm',
    durationMs: 1,
    recordedAt: '2026-11-07T10:00:00Z',
    complete: false,
  }

  it('accepts a typed comment on a region', () => {
    expect(isDraft(draft({ mode: 'typed', anchor: regionAnchor }))).toBe(true)
  })

  it('rejects a transcript without a recording', () => {
    expect(isDraft(draft({ transcript }))).toBe(false)
  })

  it('rejects audio on a typed comment, and empty audio', () => {
    expect(isDraft(draft({ mode: 'typed', audio }))).toBe(false)
    expect(isDraft(draft({ audio: { ...audio, blob: new Blob([]) } }))).toBe(
      false,
    )
  })

  it('rejects a polish without the transcript it came from', () => {
    expect(
      isDraft(
        draft({
          audio,
          cleanUp: {
            text: 'y',
            cleanUp: {
              provider: 'p',
              model: 'm',
              createdAt: '2026-11-07T10:00:00Z',
              promptVersion: 1,
            },
          },
        }),
      ),
    ).toBe(false)
  })
})

describe('draftHasContent', () => {
  it('keeps typed text or a recording, not an empty composer', () => {
    expect(draftHasContent(draft({ body: '  ' }))).toBe(false)
    expect(draftHasContent(draft({ body: 'x' }))).toBe(true)
    expect(
      draftHasContent(
        draft({
          body: '',
          audio: {
            blob: new Blob(['a']),
            mimeType: 'audio/webm',
            durationMs: 1,
            recordedAt: '2026-11-07T10:00:00Z',
            complete: false,
          },
        }),
      ),
    ).toBe(true)
  })

  it('does not keep a suggestion that still reads like the original', () => {
    expect(
      draftHasContent(draft({ mode: 'suggest', body: ' the passage ' })),
    ).toBe(false)
    expect(draftHasContent(draft({ mode: 'suggest', body: 'a passage' }))).toBe(
      true,
    )
  })
})
