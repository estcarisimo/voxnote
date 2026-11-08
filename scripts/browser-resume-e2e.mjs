// Manual end-to-end check, not part of `npm test`: drives headless Chromium
// over the DevTools protocol against the production build served at APP_URL
// (`npm run build && npm run preview`) through the "continue a review" flow:
// open a PDF, highlight and comment, export the JSON, clear IndexedDB,
// reopen the same PDF (no notes), Import notes… the JSON, and see the
// annotations back; then the landing's Continue a review list. Prints what
// it saw, and every console error or uncaught exception on the page.
//
// Usage: node scripts/browser-resume-e2e.mjs   (needs /usr/bin/chromium)
import { spawn } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:4173/voxnote/'
const WORK = mkdtempSync(join(tmpdir(), 'voxnote-resume-e2e-'))
const DOWNLOADS = join(WORK, 'downloads')
mkdirSync(DOWNLOADS)

// A two-page PDF with a text layer, made here so the check needs no fixture.
const pdf = await PDFDocument.create()
const font = await pdf.embedFont(StandardFonts.Helvetica)
for (const line of [
  'The first claim on page one needs a citation.',
  'The second page states a result without proof.',
]) {
  pdf.addPage([400, 300]).drawText(line, { x: 30, y: 200, size: 12, font })
}
const PDF_PATH = join(WORK, 'resume-sample.pdf')
writeFileSync(PDF_PATH, await pdf.save())

const chrome = spawn(
  '/usr/bin/chromium',
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--window-size=1200,900',
    // Port 0: the browser picks a free one and prints it, so a browser left
    // over from an earlier run can never answer in its place.
    '--remote-debugging-port=0',
    `--user-data-dir=${join(WORK, 'profile')}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
)
const PORT = await new Promise((resolve, reject) => {
  let seen = ''
  chrome.stderr.on('data', (chunk) => {
    seen += chunk
    const match = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(seen)
    if (match) resolve(Number(match[1]))
  })
  chrome.on('exit', () => reject(new Error('Chromium exited: ' + seen)))
})

// Never leave a headless browser holding the port behind, even on Ctrl-C.
process.on('exit', () => chrome.kill())
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => process.exit(1))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function targets() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`)
      return await res.json()
    } catch {
      await sleep(200)
    }
  }
  throw new Error('Chromium did not expose DevTools')
}

const page = (await targets()).find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let nextId = 1
const pending = new Map()
const pageProblems = []
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
  } else if (msg.method === 'Runtime.exceptionThrown') {
    pageProblems.push(
      'exception: ' + JSON.stringify(msg.params.exceptionDetails),
    )
  } else if (
    msg.method === 'Runtime.consoleAPICalled' &&
    ['error', 'warning'].includes(msg.params.type)
  ) {
    pageProblems.push(
      `console.${msg.params.type}: ` +
        msg.params.args.map((a) => a.value ?? a.description).join(' '),
    )
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
    await sleep(250)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function setFiles(selector, path) {
  const { root } = await send('DOM.getDocument')
  const { nodeId } = await send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector,
  })
  if (!nodeId) throw new Error(`No element for ${selector}`)
  await send('DOM.setFileInputFiles', { nodeId, files: [path] })
}

const landing = `!!document.querySelector('input[type="file"][accept*=".md"]')`
const annotationsButton = `[...document.querySelectorAll('header button')].find(b => b.textContent.startsWith('Annotations'))?.textContent ?? ''`
const errorText = `document.querySelector('[role="alert"]')?.textContent ?? ''`
const toolbar = `!!document.querySelector('[role="toolbar"][aria-label="Selection actions"]')`
const click = (scope, text) =>
  evaluate(
    `(() => { const b = [...document.querySelectorAll('${scope} button')].find(b => b.textContent === ${JSON.stringify(text)}); if (!b) throw new Error('no button ${text}'); b.click(); return true })()`,
  )

async function openPdf() {
  await setFiles('input[type="file"][accept*=".md"]', PDF_PATH)
  await waitFor(
    `document.querySelectorAll('.textLayer span').length >= 1`,
    20000,
    'text layer',
  )
}

/** Selects the first `n` characters of page `page`'s first text span. */
const selectOnPage = (page, n) => `(() => {
  const span = document.querySelectorAll('.pdf-page')[${page - 1}].querySelector('.textLayer span')
  span.scrollIntoView({ block: 'center' })
  const text = span.firstChild
  const range = document.createRange()
  range.setStart(text, 0); range.setEnd(text, ${n})
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(range)
  return range.toString()
})()`

try {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('DOM.enable')
  await send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: DOWNLOADS,
  })
  await send('Page.navigate', { url: APP_URL })
  await waitFor(landing, 15000, 'landing')
  console.log('landing: ok, origin', await evaluate('location.origin'))

  // 1. Annotate: a highlight on page 1, a typed comment on page 2.
  await openPdf()
  console.log(
    'opened:',
    await evaluate(`document.querySelector('.app-title').textContent`),
  )
  console.log('selected:', JSON.stringify(await evaluate(selectOnPage(1, 15))))
  await waitFor(toolbar, 5000, 'toolbar')
  await click('[role="toolbar"]', 'Highlight')
  await waitFor(`(${annotationsButton}).includes('(1)')`, 5000, 'highlight')
  await evaluate(`window.getSelection().removeAllRanges()`)
  await sleep(300)
  await waitFor(
    `document.querySelectorAll('.pdf-page')[1]?.querySelector('.textLayer span')`,
    20000,
    'page 2 text layer',
  )
  console.log('selected:', JSON.stringify(await evaluate(selectOnPage(2, 15))))
  await waitFor(toolbar, 5000, 'toolbar again')
  await click('[role="toolbar"]', 'Comment')
  await waitFor(
    `!!document.querySelector('.comment-composer textarea')`,
    5000,
    'composer',
  )
  await evaluate(`(() => {
    const t = document.querySelector('.comment-composer textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(t, 'Which result? (resume e2e)')
    t.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await click('.comment-composer', 'Save')
  await waitFor(`(${annotationsButton}).includes('(2)')`, 5000, 'comment')
  console.log('before export:', await evaluate(annotationsButton))

  // 2. Export the JSON.
  await click('header', 'JSON')
  let jsonName = null
  for (let i = 0; i < 40 && !jsonName; i++) {
    jsonName =
      readdirSync(DOWNLOADS).find((f) => f.endsWith('.voxnote.json')) ?? null
    if (!jsonName) await sleep(250)
  }
  if (!jsonName) throw new Error('No JSON was downloaded')
  const jsonPath = join(DOWNLOADS, jsonName)
  const exported = JSON.parse(readFileSync(jsonPath, 'utf8'))
  console.log(
    'exported:',
    jsonName,
    JSON.stringify({
      schemaVersion: exported.schemaVersion,
      app: exported.app,
      document: exported.document,
      annotations: exported.annotations.map((a) => a.kind),
    }),
  )

  // 3. Clear IndexedDB: close the document, then delete the database.
  await click('header', '← Close')
  await waitFor(landing, 10000, 'landing after close')
  await send('Page.navigate', { url: 'about:blank' })
  await sleep(300)
  await send('Page.navigate', { url: APP_URL })
  await waitFor(landing, 15000, 'landing again')
  await waitFor(
    `document.querySelectorAll('.recent-documents li').length > 0`,
    10000,
    'recent list before clearing',
  )
  console.log(
    'recent list before clearing:',
    JSON.stringify(
      await evaluate(
        `[...document.querySelectorAll('.recent-documents li')].map(li => li.textContent)`,
      ),
    ),
  )
  await send('Storage.clearDataForOrigin', {
    origin: await evaluate('location.origin'),
    storageTypes: 'indexeddb',
  })
  await send('Page.reload')
  await waitFor(landing, 15000, 'landing after clearing')
  await sleep(500)
  console.log(
    'databases after clearing:',
    JSON.stringify(
      await evaluate(`indexedDB.databases().then(d => d.map(x => x.name))`),
    ),
    '| recent list:',
    JSON.stringify(
      await evaluate(
        `[...document.querySelectorAll('.recent-documents li')].map(li => li.textContent)`,
      ),
    ),
  )

  // 4. Reopen the same PDF: no notes.
  await openPdf()
  await waitFor(`(${annotationsButton}).includes('(0)')`, 10000, 'empty store')
  console.log('reopened without notes:', await evaluate(annotationsButton))

  // 5. Import notes… from the header.
  await setFiles('input[type="file"][aria-label="Notes file"]', jsonPath)
  const title = await waitFor(
    `document.querySelector('[role="dialog"] h2')?.textContent ?? ((${errorText}) ? 'ERROR: ' + (${errorText}) : '')`,
    10000,
    'import dialog',
  )
  if (title.startsWith('ERROR')) throw new Error(title)
  console.log(
    'dialog:',
    title,
    '|',
    JSON.stringify(
      await evaluate(
        `document.querySelector('[aria-label="What the file holds"]').textContent`,
      ),
    ),
  )
  await click('[role="dialog"]', 'Import')
  await waitFor(
    `document.querySelector('[role="dialog"] h2')?.textContent === 'Notes imported'`,
    10000,
    'summary',
  )
  console.log(
    'summary:',
    JSON.stringify(
      await evaluate(
        `document.querySelector('[aria-label="Import summary"]').textContent`,
      ),
    ),
  )
  await click('[role="dialog"]', 'Close')
  const after = await waitFor(
    `(${annotationsButton}).includes('(2)') ? (${annotationsButton}) : ''`,
    10000,
    'annotations after import',
  )
  console.log(
    'after import:',
    after,
    '| highlight marks:',
    await evaluate(`document.querySelectorAll('.highlightLayer > *').length`),
    '| alerts:',
    JSON.stringify(await evaluate(errorText)),
  )

  // 6. Import again: everything is skipped.
  await setFiles('input[type="file"][aria-label="Notes file"]', jsonPath)
  await waitFor(
    `document.querySelector('[role="dialog"] h2')?.textContent?.startsWith('Import notes')`,
    10000,
    'second dialog',
  )
  console.log(
    'second import:',
    JSON.stringify(
      await evaluate(
        `document.querySelector('[aria-label="What the file holds"]').textContent`,
      ),
    ),
  )
  await click('[role="dialog"]', 'Cancel')

  // 7. Landing: Continue a review lists the document.
  await click('header', '← Close')
  await waitFor(
    `document.querySelectorAll('.recent-documents li').length > 0`,
    10000,
    'recent list',
  )
  console.log(
    'recent list:',
    JSON.stringify(
      await evaluate(
        `[...document.querySelectorAll('.recent-documents li')].map(li => li.textContent)`,
      ),
    ),
  )

  console.log('page problems:', pageProblems.length ? pageProblems : 'none')
  console.log('RESULT: ran in', await evaluate('navigator.userAgent'))
} finally {
  ws.close()
  chrome.kill()
}
