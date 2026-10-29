// @vitest-environment node
// Node: fake-indexeddb clones with Node's structuredClone, which handles a
// CryptoKey; jsdom's realm would not.
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { openSecretStore } from './secrets'

describe('secret store', () => {
  it('round-trips a secret and never stores it in the clear', async () => {
    const factory = new IDBFactory()
    const store = await openSecretStore('s', factory)
    await store.set('openai.apiKey', 'sk-not-a-real-key-123')
    expect(await store.get('openai.apiKey')).toBe('sk-not-a-real-key-123')
    expect(await store.list()).toEqual(['openai.apiKey'])
    expect(await store.get('missing')).toBeNull()

    // Look at the raw record behind the store's back.
    const raw = await new Promise<Record<string, unknown>>(
      (resolve, reject) => {
        const req = factory.open('s', 1)
        req.onsuccess = () => {
          const get = req.result
            .transaction('secrets')
            .objectStore('secrets')
            .get('openai.apiKey')
          get.onsuccess = () => {
            req.result.close()
            resolve(get.result)
          }
          get.onerror = () => reject(get.error)
        }
        req.onerror = () => reject(req.error)
      },
    )
    const bytes = new Uint8Array(raw.ciphertext as ArrayBuffer)
    expect(bytes.length).toBeGreaterThan('sk-not-a-real-key-123'.length)
    expect(new TextDecoder().decode(bytes)).not.toContain('sk-not')
    expect(JSON.stringify(raw)).not.toContain('sk-not')

    await store.delete('openai.apiKey')
    expect(await store.get('openai.apiKey')).toBeNull()
    store.close()
  })

  it('reuses the same encryption key across opens', async () => {
    const factory = new IDBFactory()
    const first = await openSecretStore('s', factory)
    await first.set('k', 'v1')
    first.close()
    const second = await openSecretStore('s', factory)
    expect(await second.get('k')).toBe('v1')
    second.close()
  })

  it('refuses empty names and values', async () => {
    const store = await openSecretStore('s', new IDBFactory())
    await expect(store.set('', 'x')).rejects.toThrow(/needs a name/)
    await expect(store.set('k', '')).rejects.toThrow(/empty secret/)
    store.close()
  })

  it('fails loudly when a record was tampered with', async () => {
    const factory = new IDBFactory()
    const store = await openSecretStore('s', factory)
    await store.set('k', 'secret')
    await new Promise<void>((resolve, reject) => {
      const req = factory.open('s', 1)
      req.onsuccess = () => {
        const tx = req.result.transaction('secrets', 'readwrite')
        const s = tx.objectStore('secrets')
        const get = s.get('k')
        get.onsuccess = () => {
          const record = get.result
          const bytes = new Uint8Array(record.ciphertext)
          bytes[0] ^= 0xff
          s.put(record)
        }
        tx.oncomplete = () => {
          req.result.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
    await expect(store.get('k')).rejects.toThrow(/could not be decrypted/)
    store.close()
  })
})
