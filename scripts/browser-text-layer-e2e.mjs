// Manual check, not part of `npm test`: drives headless Chromium over the
// DevTools protocol against the build served at APP_URL (`npm run build &&
// npm run preview`, or `npm run dev`), opens a PDF, and compares every text
// layer span on one page with the text pdf.js extracts for that page: the
// span's box on screen must sit where the glyphs are printed and be as wide
// as they are. A span wider than its text puts a selection's rectangles
// beside the text, into the next column on a two-column page.
// Prints the worst width and position error and a verdict.
//
// Usage: node scripts/browser-text-layer-e2e.mjs <file.pdf> [page number]
// Env: APP_URL (default http://127.0.0.1:4173/voxnote/), TOLERANCE (fraction
//      of the text width, default 0.05). Needs /usr/bin/chromium.
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

// What pdf.js prints: each text item's left edge and width in PDF user
// space, with the page's media box to map them to the screen.
const loadingTask = getDocument({ data: new Uint8Array(readFileSync(FILE)) })
const pdf = await loadingTask.promise
const pdfPage = await pdf.getPage(PAGE)
const viewport = pdfPage.getViewport({ scale: 1 })
const textContent = await pdfPage.getTextContent()
const printed = textContent.items
  .filter((item) => 'str' in item && item.str.trim() !== '' && item.width > 0)
  .map((item) => ({ text: item.str, x: item.transform[4], width: item.width }))
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
          return { text: s.textContent, left: r.left - origin.left, width: r.width }
        }),
    }
  })()`)
  const scale = screen.pageWidth / viewport.width

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
    const expectedLeft = (item.x - viewport.viewBox[0]) * scale
    const expectedWidth = item.width * scale
    errors.push({
      text: item.text,
      widthPt: item.width,
      widthError: Math.abs(span.width - expectedWidth) / expectedWidth,
      leftError: Math.abs(span.left - expectedLeft) / expectedWidth,
    })
  }
  const percent = (v) => `${(v * 100).toFixed(1)}%`
  const sorted = errors.map((e) => e.widthError).sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? NaN
  const wide = errors.filter((e) => e.widthPt >= MIN_WIDTH_PT)
  const worst = wide.reduce((w, e) => (e.widthError > w.widthError ? e : w), {
    widthError: -1,
    leftError: 0,
    text: '',
  })
  console.log(
    `page ${PAGE}: ${errors.length} spans compared (${wide.length} at least ${MIN_WIDTH_PT} pt wide), ${unmatched} printed items without a span, scale ${scale.toFixed(3)}`,
  )
  console.log(
    `width error, all spans: median ${percent(median)} of the text width`,
  )
  console.log(
    `width error, wide spans: worst ${percent(worst.widthError)} (position error ${percent(worst.leftError)}) on ${JSON.stringify(worst.text.slice(0, 50))}`,
  )
  const ok = wide.length > 0 && worst.widthError <= TOLERANCE
  console.log(
    `RESULT: ${ok ? 'PASS' : 'FAIL'} (tolerance ${percent(TOLERANCE)} on wide spans) in`,
    await evaluate('navigator.userAgent'),
  )
  process.exitCode = ok ? 0 : 1
} finally {
  ws.close()
  chrome.kill()
}
