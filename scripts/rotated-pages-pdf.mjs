// Writes a four-page test PDF for the text layer check on rotated pages:
// page 1 unrotated, then /Rotate 90, 180 and 270. Each
// page is US Letter with the same six lines of text at known positions, so
// the only difference between the pages is the rotation entry.
// Usage: node scripts/rotated-pages-pdf.mjs <output .pdf>
import { writeFileSync } from 'node:fs'
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib'

const out = process.argv[2]
if (!out) throw new Error('Pass the output path for the PDF')

const doc = await PDFDocument.create()
const font = await doc.embedFont(StandardFonts.Helvetica)
for (const rotation of [0, 90, 180, 270]) {
  const page = doc.addPage([612, 792])
  page.setRotation(degrees(rotation))
  page.drawText(`Page rotated ${rotation} degrees`, {
    x: 72,
    y: 700,
    size: 24,
    font,
  })
  const lines = [
    'The quick brown fox jumps over the lazy dog.',
    'Pack my box with five dozen liquor jugs.',
    'How vexingly quick daft zebras jump!',
    'Sphinx of black quartz, judge my vow.',
  ]
  lines.forEach((text, i) => {
    page.drawText(text, { x: 72, y: 640 - i * 40, size: 12, font })
  })
  page.drawText('Bottom right corner', { x: 400, y: 72, size: 10, font })
}
writeFileSync(out, await doc.save())
console.log('wrote', out)
