import { describe, expect, it } from 'vitest'
import { computeDocumentId, isPdfFile } from './pdf'

describe('computeDocumentId', () => {
  it('returns the SHA-256 hex digest of the bytes', async () => {
    // Known vector: SHA-256("abc").
    const id = await computeDocumentId(new TextEncoder().encode('abc'))
    expect(id).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('is stable for equal content and differs otherwise', async () => {
    const a = await computeDocumentId(new Uint8Array([1, 2, 3]))
    const b = await computeDocumentId(new Uint8Array([1, 2, 3]))
    const c = await computeDocumentId(new Uint8Array([1, 2, 4]))
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})

describe('isPdfFile', () => {
  it('accepts by MIME type or by extension', () => {
    expect(isPdfFile(new File([], 'x.bin', { type: 'application/pdf' }))).toBe(
      true,
    )
    expect(isPdfFile(new File([], 'paper.PDF', { type: '' }))).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isPdfFile(new File([], 'notes.txt', { type: 'text/plain' }))).toBe(
      false,
    )
  })
})
