import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
} from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { createComment, createHighlight } from './annotations'
import { exportAnnotatedPdf } from './exportPdf'

async function twoPagePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.addPage([400, 600])
  pdf.addPage([400, 600])
  return pdf.save()
}

function annots(page: { node: PDFDict }, pdf: PDFDocument): PDFDict[] {
  const arr = page.node.lookup(PDFName.of('Annots'))
  if (!(arr instanceof PDFArray)) return []
  return arr.asArray().map((ref) => pdf.context.lookup(ref, PDFDict))
}

const numbers = (dict: PDFDict, key: string): number[] =>
  (dict.lookup(PDFName.of(key)) as PDFArray)
    .asArray()
    .map((n) => (n as PDFNumber).asNumber())

describe('exportAnnotatedPdf', () => {
  it('writes Highlight and Square annotations on the right pages and leaves the original untouched', async () => {
    const original = await twoPagePdf()
    const before = original.slice()
    const text = createHighlight({
      documentId: 'doc',
      anchor: {
        type: 'text',
        page: 2,
        quote: 'two lines',
        rects: [
          { x: 10, y: 500, width: 100, height: 12 },
          { x: 10, y: 486, width: 60, height: 12 },
        ],
      },
    })
    const region = createHighlight({
      documentId: 'doc',
      anchor: {
        type: 'region',
        page: 1,
        rect: { x: 50, y: 50, width: 200, height: 100 },
      },
    })

    const out = await exportAnnotatedPdf(original, [text, region])
    expect(original).toEqual(before)

    const pdf = await PDFDocument.load(out)
    const [p1, p2] = pdf.getPages()

    const [square] = annots(p1, pdf)
    expect(square.lookup(PDFName.of('Subtype'))).toBe(PDFName.of('Square'))
    expect(numbers(square, 'Rect')).toEqual([50, 50, 250, 150])

    const [highlight] = annots(p2, pdf)
    expect(highlight.lookup(PDFName.of('Subtype'))).toBe(
      PDFName.of('Highlight'),
    )
    expect(numbers(highlight, 'Rect')).toEqual([10, 486, 110, 512])
    expect(numbers(highlight, 'QuadPoints')).toEqual([
      10,
      512,
      110,
      512,
      10,
      500,
      110,
      500, // line 1: UL UR LL LR
      10,
      498,
      70,
      498,
      10,
      486,
      70,
      486, // line 2
    ])
    expect(highlight.lookup(PDFName.of('NM'))?.toString()).toContain(text.id)
  })

  it('writes a comment body into Contents, with its own color', async () => {
    const original = await twoPagePdf()
    const comment = createComment({
      documentId: 'doc',
      anchor: {
        type: 'text',
        page: 1,
        quote: 'q',
        rects: [{ x: 10, y: 500, width: 100, height: 12 }],
      },
      body: 'Cita la fuente — ¿de dónde sale el 0.7?',
    })
    const highlight = createHighlight({
      documentId: 'doc',
      anchor: {
        type: 'region',
        page: 1,
        rect: { x: 0, y: 0, width: 10, height: 10 },
      },
    })
    const pdf = await PDFDocument.load(
      await exportAnnotatedPdf(original, [comment, highlight]),
    )
    const [c, h] = annots(pdf.getPages()[0], pdf)
    const contents = c.lookup(PDFName.of('Contents'))
    expect(contents).toBeInstanceOf(PDFHexString)
    expect((contents as PDFHexString).decodeText()).toBe(comment.body)
    expect(numbers(c, 'C')).toEqual([0.3, 0.55, 1])
    expect(
      (h.lookup(PDFName.of('Contents')) as PDFHexString).decodeText(),
    ).toBe('')
    expect(numbers(h, 'C')).toEqual([1, 0.85, 0.2])
  })

  it('round-trips non-Latin-1 comment text through Contents', async () => {
    const body = 'Señor, café ☕ — 日本語 𝒳'
    const comment = createComment({
      documentId: 'doc',
      anchor: {
        type: 'region',
        page: 1,
        rect: { x: 0, y: 0, width: 10, height: 10 },
      },
      body,
    })
    const pdf = await PDFDocument.load(
      await exportAnnotatedPdf(await twoPagePdf(), [comment]),
    )
    const [annot] = annots(pdf.getPages()[0], pdf)
    expect(
      (annot.lookup(PDFName.of('Contents')) as PDFHexString).decodeText(),
    ).toBe(body)
  })

  it('fails loudly when an annotation points past the last page', async () => {
    const original = await twoPagePdf()
    const bad = createHighlight({
      documentId: 'doc',
      anchor: {
        type: 'region',
        page: 3,
        rect: { x: 0, y: 0, width: 1, height: 1 },
      },
    })
    await expect(exportAnnotatedPdf(original, [bad])).rejects.toThrow(/page 3/)
  })
})
