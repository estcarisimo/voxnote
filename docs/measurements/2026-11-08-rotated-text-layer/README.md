# Rotated pages: text layer measurements of 2026-11-08 (UTC)

The raw output behind the "Text selection and highlights line up on rotated
pages" entry in `CHANGELOG.md`. Each block in the logs is one run of
`scripts/browser-text-layer-e2e.mjs` on one page; `<scratch>` replaces the
local scratch directory that held the test PDF.

## Setup

- Headless Chromium 155.0.0.0 (Arch Linux) with
  `--headless=new --no-sandbox --disable-gpu --window-size=1200,1000`.
- The app served by `npm run dev` (Vite 8.3.5) on this branch, at
  `http://127.0.0.1:5188/`.
- Document: the four-page PDF written by `scripts/rotated-pages-pdf.mjs`
  (pdf-lib): US Letter pages with the same six lines of Helvetica text,
  pages 1 to 4 with `/Rotate` 0, 90, 180 and 270. pdf.js reports the two
  sideways pages as 792 x 612 pt viewports.
- `before.log`: pages 1, 2 and 3 of the three-page fixture (rotations 0, 90
  and 270) with `main` at 7dea478's stylesheet, then page 3 of the four-page
  fixture (rotation 180) with that one rule disabled in the stylesheet.
- `after.log`: pages 1, 2 and 3 of the three-page fixture, then pages 3 and
  4 of the four-page fixture (rotations 180 and 270), with the three
  `[data-main-rotation]` rules in `src/components/PdfPage.css`.

## What the numbers mean

For each printed text item the script maps the item's box through the
page's viewport (`convertToViewportPoint`, so a `/Rotate` entry rotates
it as the canvas is rotated) and compares it with the span's box on
screen. "Length" is the span's extent along the text's direction on screen
(horizontal at 0 and 180, vertical at 90 and 270); "position along" is the
offset of the edge where the text starts; "position across" is the offset
of the line's center, in line heights. pdf.js tops a span at the font's
ascent, not at the item's box, so about a fifth of a line across is the
expected residue on every page, rotated or not.
