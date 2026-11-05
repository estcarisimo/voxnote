// Manual end-to-end check, not part of `npm test`: drives headless Chromium
// over the DevTools protocol against the production build served at APP_URL
// (`npm run build && npm run preview`), opens a Markdown file, highlights and
// comments on passages, reloads and reopens the file to find the annotations
// again, and exports the Markdown report. Prints what it saw, and every
// console error or uncaught exception on the page.
//
// Usage: node scripts/browser-markdown-e2e.mjs <path to a .md file>
// Needs /usr/bin/chromium.
import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:4173/voxnote/'
const MD_PATH = process.argv[2]
if (!MD_PATH) throw new Error('Pass the path to a Markdown file')
const PORT = 9334
const DOWNLOADS = mkdtempSync(join(tmpdir(), 'voxnote-md-downloads-'))

const chrome = spawn(
  '/usr/bin/chromium',
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--window-size=1200,900',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'voxnote-md-e2e-'))}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

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

async function openFile() {
  const { root } = await send('DOM.getDocument')
  const { nodeId } = await send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: 'input[type="file"][accept*=".md"]',
  })
  await send('DOM.setFileInputFiles', { nodeId, files: [MD_PATH] })
  await waitFor(`!!document.querySelector('.markdown-view')`, 15000, 'document')
}

/** Selects characters [start, end) of the first text node of block `n`. */
const selectIn = (n, start, end) => `(() => {
  const block = document.querySelector('[data-block="${n}"]')
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  const text = walker.nextNode()
  const range = document.createRange()
  range.setStart(text, ${start}); range.setEnd(text, ${end})
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(range)
  return range.toString()
})()`

const toolbar = `!!document.querySelector('[role="toolbar"][aria-label="Selection actions"]')`
const annotationsButton = `[...document.querySelectorAll('header button')].find(b => b.textContent.startsWith('Annotations'))?.textContent ?? ''`
const errorText = `document.querySelector('[role="alert"]')?.textContent ?? ''`

try {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('DOM.enable')
  await send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: DOWNLOADS,
  })
  await send('Page.navigate', { url: APP_URL })
  await waitFor(
    `!!document.querySelector('input[type="file"][accept*=".md"]')`,
    15000,
    'landing',
  )
  console.log('landing: ok, origin', await evaluate('location.origin'))
  console.log(
    'open button:',
    await evaluate(`document.querySelector('.open-pdf-button').textContent`),
  )

  await openFile()
  console.log(
    'opened:',
    await evaluate(`document.querySelector('.app-title').textContent`),
    '| blocks:',
    await evaluate(`document.querySelectorAll('[data-block]').length`),
    '| images loaded:',
    await evaluate(`document.querySelectorAll('img').length`),
    '| region tool present:',
    await evaluate(`!!document.querySelector('[aria-label="Selection tool"]')`),
    '| Export PDF present:',
    await evaluate(
      `[...document.querySelectorAll('header button')].some(b => b.textContent === 'Export PDF')`,
    ),
  )

  // Highlight a passage of block 2.
  console.log('selected:', JSON.stringify(await evaluate(selectIn(2, 4, 20))))
  await waitFor(toolbar, 5000, 'toolbar')
  await evaluate(
    `[...document.querySelectorAll('[role="toolbar"] button')].find(b => b.textContent === 'Highlight').click()`,
  )
  await waitFor(
    `(${annotationsButton}).includes('(1)')`,
    5000,
    'highlight saved',
  )
  const marks = await evaluate(
    `[...document.querySelectorAll('.markdown-marks .mark')].map(m => { const r = m.getBoundingClientRect(); return [m.className, Math.round(r.width), Math.round(r.height)] })`,
  )
  console.log('marks after highlight:', JSON.stringify(marks))

  // Comment on a passage of block 3.
  console.log('selected:', JSON.stringify(await evaluate(selectIn(3, 0, 12))))
  await waitFor(toolbar, 5000, 'toolbar again')
  await evaluate(
    `[...document.querySelectorAll('[role="toolbar"] button')].find(b => b.textContent === 'Comment').click()`,
  )
  await waitFor(
    `!!document.querySelector('.comment-composer textarea')`,
    5000,
    'composer',
  )
  await evaluate(`(() => {
    const t = document.querySelector('.comment-composer textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(t, 'Needs a citation (e2e).')
    t.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await evaluate(
    `[...document.querySelectorAll('.comment-composer button')].find(b => b.textContent === 'Save').click()`,
  )
  await waitFor(`(${annotationsButton}).includes('(2)')`, 5000, 'comment saved')
  console.log('annotations button:', await evaluate(annotationsButton))

  // Cross-block selection: no toolbar.
  await evaluate(`(() => {
    const a = document.querySelector('[data-block="1"]').firstChild
    const b = document.querySelector('[data-block="2"]').firstChild
    const range = document.createRange(); range.setStart(a, 0); range.setEnd(b, 3)
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(range); return true
  })()`)
  await sleep(600)
  console.log('toolbar for a cross-block selection:', await evaluate(toolbar))
  await evaluate(`window.getSelection().removeAllRanges()`)

  // Sidebar labels.
  await evaluate(
    `(${annotationsButton}) && [...document.querySelectorAll('header button')].find(b => b.textContent.startsWith('Annotations')).click()`,
  )
  await waitFor(`!!document.querySelector('.annotation-list')`, 5000, 'sidebar')
  console.log(
    'sidebar places:',
    JSON.stringify(
      await evaluate(
        `[...document.querySelectorAll('.annotation-list-page')].map(e => e.textContent)`,
      ),
    ),
  )

  // Export the Markdown report.
  await evaluate(
    `[...document.querySelectorAll('header button')].find(b => b.textContent === 'Markdown').click()`,
  )
  let report = null
  for (let i = 0; i < 40 && !report; i++) {
    const files = readdirSync(DOWNLOADS).filter((f) => f.endsWith('.md'))
    if (files.length) report = readFileSync(join(DOWNLOADS, files[0]), 'utf8')
    else await sleep(250)
  }
  if (!report) throw new Error('No Markdown report was downloaded')
  console.log('--- report ---\n' + report + '--- end of report ---')

  // Reload and reopen the same file: the annotations must come back.
  await send('Page.navigate', { url: APP_URL })
  await waitFor(
    `!!document.querySelector('input[type="file"][accept*=".md"]')`,
    15000,
    'landing after reload',
  )
  await openFile()
  const after = await waitFor(
    `(${annotationsButton}).includes('(2)') ? (${annotationsButton}) : ''`,
    10000,
    'annotations after reopen',
  )
  console.log(
    'after reload:',
    after,
    '| marks:',
    await evaluate(`document.querySelectorAll('.markdown-marks .mark').length`),
    '| alerts:',
    JSON.stringify(await evaluate(errorText)),
  )

  console.log('page problems:', pageProblems.length ? pageProblems : 'none')
  console.log('RESULT: ran in', await evaluate('navigator.userAgent'))
} finally {
  ws.close()
  chrome.kill()
}
