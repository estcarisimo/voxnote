/**
 * Writes annotations into a *copy* of the PDF as native annotation objects
 * (PDF 32000-1:2008, section 12.5.6). The original bytes are never modified.
 *
 * Text anchors become /Highlight annotations with one quadrilateral per line;
 * regions become /Square annotations. A comment's body goes into /Contents,
 * which viewers show as the annotation's note. Voice recordings are not
 * embedded: only the text is exported.
 */
import {
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFString,
  type PDFDict,
  type PDFObject,
  type PDFPage,
} from 'pdf-lib'
import { unionRects, type Annotation, type PdfRect } from './annotations'

const HIGHLIGHT_COLOR = [1, 0.85, 0.2] as const
const COMMENT_COLOR = [0.3, 0.55, 1] as const
const AUTHOR = 'VoxNote'

export async function exportAnnotatedPdf(
  original: Uint8Array,
  annotations: readonly Annotation[],
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(original, { updateMetadata: false })
  const pages = pdf.getPages()

  for (const annotation of annotations) {
    const page = pages[annotation.anchor.page - 1]
    if (!page) {
      throw new Error(
        `Annotation ${annotation.id} points at page ${annotation.anchor.page}, but the document has ${pages.length}`,
      )
    }
    const annot: PDFDict = pdf.context.obj(
      annotationDict(pdf, page, annotation),
    )
    page.node.addAnnot(pdf.context.register(annot))
  }

  return pdf.save({ useObjectStreams: false })
}

function annotationDict(
  pdf: PDFDocument,
  page: PDFPage,
  annotation: Annotation,
): Record<string, string | number | PDFObject> {
  const { anchor } = annotation
  const common = {
    Type: 'Annot',
    T: PDFString.of(AUTHOR),
    NM: PDFString.of(annotation.id),
    M: PDFString.fromDate(new Date(annotation.updatedAt)),
    CreationDate: PDFString.fromDate(new Date(annotation.createdAt)),
    F: 4, // Print
    C: pdf.context.obj([
      ...(annotation.kind === 'comment' ? COMMENT_COLOR : HIGHLIGHT_COLOR),
    ]),
    P: page.ref,
    // PDFHexString handles any Unicode; PDFString.of would mangle non-Latin-1.
    Contents: PDFHexString.fromText(
      annotation.kind === 'comment' ? annotation.body : '',
    ),
  }

  if (anchor.type === 'text') {
    return {
      ...common,
      Subtype: 'Highlight',
      Rect: rectArray(pdf, unionRects(anchor.rects)),
      QuadPoints: quadPoints(pdf, anchor.rects),
    }
  }
  return {
    ...common,
    Subtype: 'Square',
    Rect: rectArray(pdf, anchor.rect),
    BS: pdf.context.obj({ W: 1.5, S: 'S' }),
  }
}

function rectArray(pdf: PDFDocument, r: PdfRect): PDFArray {
  return pdf.context.obj([r.x, r.y, r.x + r.width, r.y + r.height])
}

/**
 * QuadPoints order per quadrilateral: upper-left, upper-right, lower-left,
 * lower-right (x y pairs). Viewers are strict about this order.
 */
function quadPoints(pdf: PDFDocument, rects: readonly PdfRect[]): PDFArray {
  const numbers: number[] = []
  for (const r of rects) {
    const x1 = r.x
    const x2 = r.x + r.width
    const y1 = r.y
    const y2 = r.y + r.height
    numbers.push(x1, y2, x2, y2, x1, y1, x2, y1)
  }
  return pdf.context.obj(numbers)
}
