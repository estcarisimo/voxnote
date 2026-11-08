import { PDFDocument, StandardFonts } from 'pdf-lib'
import { writeFileSync } from 'node:fs'
const pdf = await PDFDocument.create()
const font = await pdf.embedFont(StandardFonts.Helvetica)
for (let i = 1; i <= 80; i++) {
  const page = pdf.addPage([595.28, 841.89])
  for (let l = 0; l < 40; l++)
    page.drawText(
      `Page ${i}, line ${l + 1}: the quick brown fox jumps over the lazy dog.`,
      { x: 50, y: 790 - l * 18, size: 11, font },
    )
}
writeFileSync(process.argv[2], await pdf.save())
