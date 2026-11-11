import { describe, expect, it, vi } from 'vitest'
import { parseMarkdown } from '../core/markdown'
import { markdownBlocksText, pdfPageText } from './passageText'
import type { PDFDocumentProxy } from 'pdfjs-dist'

describe('markdownBlocksText', () => {
  const doc = parseMarkdown(
    ['# One', 'Two', 'Three', 'Four', 'Five', 'Six'].join('\n\n'),
  )

  it('joins the block and its neighbors, clipped to the document', () => {
    expect(markdownBlocksText(doc, 1, 1)).toBe('One\n\nTwo')
    expect(markdownBlocksText(doc, 4, 1)).toBe('Three\n\nFour\n\nFive')
    expect(markdownBlocksText(doc, 6, 2)).toBe('Four\n\nFive\n\nSix')
  })
})

describe('pdfPageText', () => {
  it('joins the text items of the page', async () => {
    const getTextContent = vi.fn(async () => ({
      items: [
        { str: 'the qubit' },
        { type: 'beginMarkedContent' },
        { str: 'decoheres' },
      ],
    }))
    const pdf = {
      getPage: vi.fn(async () => ({ getTextContent })),
    } as unknown as PDFDocumentProxy
    await expect(pdfPageText(pdf, 2)).resolves.toBe('the qubit  decoheres')
    expect(pdf.getPage).toHaveBeenCalledWith(2)
  })
})
