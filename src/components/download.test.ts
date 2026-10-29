import { afterEach, describe, expect, it, vi } from 'vitest'
import { baseName, downloadFile } from './download'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('downloadFile', () => {
  it('clicks a link to an object URL with the file name, then revokes it', async () => {
    vi.useFakeTimers()
    const createObjectURL = vi.fn<(blob: Blob) => string>(
      () => 'blob:voxnote/1',
    )
    const revokeObjectURL = vi.fn()
    // jsdom has no object URLs; stand in for the two static methods only.
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe('paper.voxnote.md')
        expect(this.getAttribute('href')).toBe('blob:voxnote/1')
      })

    downloadFile('# Notes\n', 'paper.voxnote.md', 'text/markdown')

    expect(click).toHaveBeenCalledOnce()
    const blob = createObjectURL.mock.calls[0][0]
    expect(blob.type).toBe('text/markdown')
    expect(await blob.text()).toBe('# Notes\n')
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:voxnote/1')
  })
})

describe('baseName', () => {
  it('drops a .pdf extension in any case and keeps anything else', () => {
    expect(baseName('paper.PDF')).toBe('paper')
    expect(baseName('notes.pdf.txt')).toBe('notes.pdf.txt')
  })
})
