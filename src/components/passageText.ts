/**
 * The document text around a passage, for a question about it. Read from
 * what is already in memory: the pdf.js document or the parsed Markdown.
 * Nothing is fetched and nothing is sent from here.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { blockPlainText, type MarkdownDocument } from '../core/markdown'

/** The text content of one PDF page, items joined by spaces. */
export async function pdfPageText(
  pdf: PDFDocumentProxy,
  page: number,
): Promise<string> {
  const content = await (await pdf.getPage(page)).getTextContent()
  return content.items.map((item) => ('str' in item ? item.str : '')).join(' ')
}

/** How many blocks on each side of the passage's block are read. */
export const BLOCKS_AROUND = 3

/** The plain text of a block and its neighbors, separated by blank lines. */
export function markdownBlocksText(
  markdown: MarkdownDocument,
  block: number,
  around: number = BLOCKS_AROUND,
): string {
  const first = Math.max(1, block - around)
  const last = Math.min(markdown.blocks.length, block + around)
  const parts: string[] = []
  for (let n = first; n <= last; n++) {
    parts.push(blockPlainText(markdown.blocks[n - 1]))
  }
  return parts.join('\n\n')
}
