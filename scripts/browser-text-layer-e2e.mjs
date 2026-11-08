// Manual check, not part of `npm test`: drives headless Chromium over the
// DevTools protocol against the build served at APP_URL (`npm run build &&
// npm run preview`, or `npm run dev`), opens a PDF, and compares every text
// layer span on one page with the text pdf.js extracts for that page: the
// span's box on screen must sit where the glyphs are printed and be as long
// as they are. A span longer than its text puts a selection's rectangles
// beside the text, into the next column on a two-column page; a span away
// from its text (every span, on a page with a /Rotate entry whose text
// layer is not turned with the canvas) puts them on other lines entirely.
// Prints the worst length and position errors and a verdict.
//
// Each printed item's box is mapped to the screen through the page's
// viewport (`convertToViewportPoint`), so a page rotated by its /Rotate
// entry is compared in its rotated frame: text then runs down or up the
// screen, and "length" is the span's extent along that direction.
//
// Usage: node scripts/browser-text-layer-e2e.mjs <file.pdf> [page number]
// Env: APP_URL (default http://127.0.0.1:4173/voxnote/), TOLERANCE (fraction
//      of the text length, default 0.05). Needs /usr/bin/chromium.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:4173/voxnote/'
const FILE = process.argv[2]
if (!FILE) throw new Error('Pass the path to a .pdf')
const PAGE = Number(process.argv[3] ?? 1)
const TOLERANCE = Number(process.env.TOLERANCE ?? 0.05)

// What pdf.js prints: each text item's origin (its baseline's start), its
// width and its font height in PDF user space, with the page's viewport at
// scale 1 (rotated by the page's /Rotate entry, as the app's is) to map
// them to the screen.
const loadingTask = getDocument({ data: new Uint8Array(readFileSync(FILE)) })
const pdf = await loadingTask.promise
const pdfPage = await pdf.getPage(PAGE)
const viewport = pdfPage.getViewport({ scale: 1 })
const textContent = await pdfPage.getTextContent()
const printed = textContent.items
  .filter((item) => 'str' in item && item.str.trim() !== '' && item.width > 0)
  .map((item) => ({
    text: item.str,
    x: item.transform[4],
    y: item.transform[5],
    width: item.width,
    height: item.height,
  }))
await loadingTask.destroy()

const profileDir = mkdtempSync(join(tmpdir(), 'voxnote-text-layer-'))
const chrome = spawn(
  '/usr/bin/chromium',
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--window-size=1200,1000',
    // Port 0: Chromium picks a free port and writes it to the profile, so
    // this script never attaches to another session's browser.
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function targets() {
  for (let i = 0; i < 50; i++) {
    try {
      const port = readFileSync(
        join(profileDir, 'DevToolsActivePort'),
        'utf8',
      ).split('\n')[0]
      const res = await fetch(`http://127.0.0.1:${port}/json`)
      return await res.json()
    } catch {
      await sleep(200)
    }
  }
  throw new Error('Chromium did not expose DevTools')
}

const target = (await targets()).find((t) => t.type === 'page')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let nextId = 1
const pending = new Map()
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
  }
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })

async function evaluate(expression) {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (exceptionDetails)
    throw new Error(
      exceptionDetails.text + ' ' + JSON.stringify(exceptionDetails.exception),
    )
  return result.value
}

async function waitFor(expression, timeoutMs, label) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const v = await evaluate(expression)
    if (v) return v
    await sleep(300)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

try {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('DOM.enable')
  await send('Page.navigate', { url: APP_URL })
  await waitFor(
    `!!document.querySelector('input[type=file]')`,
    15000,
    'landing',
  )
  const { root } = await send('DOM.getDocument')
  const { nodeId } = await send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: 'input[type=file]',
  })
  await send('DOM.setFileInputFiles', { nodeId, files: [resolve(FILE)] })

  // Scroll the page into view and wait for its text layer and the fonts.
  const pageSelector = `.pdf-page[data-page-number="${PAGE}"]`
  await waitFor(`!!document.querySelector('${pageSelector}')`, 30000, 'page')
  await evaluate(
    `document.querySelector('${pageSelector}').scrollIntoView({ block: 'start' })`,
  )
  await waitFor(
    `!!document.querySelector('${pageSelector} .textLayer span') && document.fonts.status === 'loaded'`,
    30000,
    'text layer',
  )
  await sleep(1000)

  // Every span with text: its box relative to the page element, in CSS px.
  const screen = await evaluate(`(() => {
    const page = document.querySelector('${pageSelector}')
    const origin = page.getBoundingClientRect()
    return {
      pageWidth: origin.width,
      spans: [...page.querySelectorAll('.textLayer span')]
        .filter((s) => s.textContent.trim() !== '' && s.childElementCount === 0)
        .map((s) => {
          const r = s.getBoundingClientRect()
          return {
            text: s.textContent,
            left: r.left - origin.left,
            top: r.top - origin.top,
            width: r.width,
            height: r.height,
          }
        }),
    }
  })()`)
  const scale = screen.pageWidth / viewport.width
  const rotation = viewport.rotation

  // A PDF user-space point → CSS px relative to the page's top-left corner.
  const toScreen = (x, y) =>
    viewport.convertToViewportPoint(x, y).map((v) => v * scale)
  // The box the item's glyphs occupy on screen: baseline origin to
  // (origin + width, origin + font height), through the rotated viewport.
  const expectedBox = (item) => {
    const corners = [
      toScreen(item.x, item.y),
      toScreen(item.x + item.width, item.y),
      toScreen(item.x, item.y + item.height),
      toScreen(item.x + item.width, item.y + item.height),
    ]
    const xs = corners.map((c) => c[0])
    const ys = corners.map((c) => c[1])
    const left = Math.min(...xs)
    const top = Math.min(...ys)
    // Which way the text runs on screen: from the baseline's start to its
    // end. Horizontal on an unrotated page, vertical at 90 or 270.
    const [sx, sy] = corners[0]
    const [ex, ey] = corners[1]
    const horizontal = Math.abs(ex - sx) >= Math.abs(ey - sy)
    return {
      left,
      top,
      width: Math.max(...xs) - left,
      height: Math.max(...ys) - top,
      horizontal,
      // The edge where the text starts, along its direction.
      start: horizontal
        ? ex > sx
          ? 'left'
          : 'right'
        : ey > sy
          ? 'top'
          : 'bottom',
    }
  }
  const edge = (box, side) =>
    side === 'left'
      ? box.left
      : side === 'right'
        ? box.left + box.width
        : side === 'top'
          ? box.top
          : box.top + box.height

  // Match each printed item to the span with the same text; a text printed
  // more than once is matched in document order.
  const spansByText = new Map()
  for (const s of screen.spans) {
    if (!spansByText.has(s.text)) spansByText.set(s.text, [])
    spansByText.get(s.text).push(s)
  }
  // pdf.js fits each span to its printed width by measuring the text in a
  // substitute font, so a one-glyph span can be off by a pixel either way;
  // the verdict rests on spans at least MIN_WIDTH_PT wide, where a wrong
  // font size or a missing scaleX shows as tens of percent.
  const MIN_WIDTH_PT = 30
  const errors = []
  let unmatched = 0
  for (const item of printed) {
    const span = spansByText.get(item.text)?.shift()
    if (!span) {
      unmatched++
      continue
    }
    const expected = expectedBox(item)
    // Along the text: its length and where it starts. Across it: the
    // center of the line. pdf.js tops a span at the font's ascent above the
    // baseline, so a fraction of a line's height across is expected.
    const along = expected.horizontal ? 'width' : 'height'
    const across = expected.horizontal ? 'height' : 'width'
    const center = (box, axis) =>
      axis === 'width' ? box.left + box.width / 2 : box.top + box.height / 2
    errors.push({
      text: item.text,
      widthPt: item.width,
      widthError: Math.abs(span[along] - expected[along]) / expected[along],
      leftError:
        Math.abs(edge(span, expected.start) - edge(expected, expected.start)) /
        expected[along],
      acrossError:
        Math.abs(center(span, across) - center(expected, across)) /
        expected[across],
    })
  }
  const percent = (v) => `${(v * 100).toFixed(1)}%`
  const sorted = errors.map((e) => e.widthError).sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? NaN
  const wide = errors.filter((e) => e.widthPt >= MIN_WIDTH_PT)
  const worstBy = (key) =>
    wide.reduce((w, e) => (e[key] > w[key] ? e : w), {
      widthError: -1,
      leftError: -1,
      acrossError: -1,
      text: '',
    })
  const worst = worstBy('widthError')
  const worstPosition = worstBy('leftError')
  const worstAcross = worstBy('acrossError')
  console.log(
    `page ${PAGE} (rotation ${rotation}): ${errors.length} spans compared (${wide.length} at least ${MIN_WIDTH_PT} pt wide), ${unmatched} printed items without a span, scale ${scale.toFixed(3)}`,
  )
  console.log(
    `length error, all spans: median ${percent(median)} of the text length`,
  )
  console.log(
    `length error, wide spans: worst ${percent(worst.widthError)} on ${JSON.stringify(worst.text.slice(0, 50))}`,
  )
  console.log(
    `position error along the text, wide spans: worst ${percent(worstPosition.leftError)} of the text length on ${JSON.stringify(worstPosition.text.slice(0, 50))}`,
  )
  console.log(
    `position error across the text, wide spans: worst ${percent(worstAcross.acrossError)} of the line height on ${JSON.stringify(worstAcross.text.slice(0, 50))}`,
  )
  // Across the text, pdf.js's span sits a fraction of a line above the
  // item's box (ascent against font height); a wrong line is 100 % or more.
  const ACROSS_TOLERANCE = 0.5
  const ok =
    wide.length > 0 &&
    worst.widthError <= TOLERANCE &&
    worstPosition.leftError <= TOLERANCE &&
    worstAcross.acrossError <= ACROSS_TOLERANCE
  console.log(
    `RESULT: ${ok ? 'PASS' : 'FAIL'} (tolerance ${percent(TOLERANCE)} of the text length along it, ${percent(ACROSS_TOLERANCE)} of the line height across it, on wide spans) in`,
    await evaluate('navigator.userAgent'),
  )
  process.exitCode = ok ? 0 : 1
} finally {
  ws.close()
  chrome.kill()
}
