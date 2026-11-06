// Manual end-to-end check, not part of `npm test`: drives headless Chromium over the DevTools protocol against the production
// build served at APP_URL, exercising "open from a link" and "open an
// Internet-Draft (XML)" against the live hosts. Prints what it saw.
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:4173/voxnote/'
// Usage: node scripts/browser-e2e.mjs <path to a draft .xml>  (needs /usr/bin/chromium)
const XML_PATH = process.argv[2]
if (!XML_PATH) throw new Error('Pass the path to an Internet-Draft .xml')
const PORT = 9333

const chrome = spawn(
  '/usr/bin/chromium',
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'voxnote-e2e-'))}`,
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

const errorText = `document.querySelector('[role="alert"]')?.textContent ?? ''`
const titleText = `document.querySelector('.app-title')?.textContent ?? ''`

try {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('DOM.enable')
  await send('Page.navigate', { url: APP_URL })
  await waitFor(`!!document.getElementById('open-pdf-url')`, 15000, 'landing')
  console.log('landing: ok, origin', await evaluate('location.origin'))

  // Flow 1: open from a link.
  await evaluate(`(() => {
    const input = document.getElementById('open-pdf-url')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, 'https://www.rfc-editor.org/rfc/rfc9000.pdf')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.form.requestSubmit()
    return true
  })()`)
  const rfcTitle = await waitFor(
    `(${titleText}) || ((${errorText}) ? 'ERROR: ' + (${errorText}) : '')`,
    60000,
    'RFC to open',
  )
  console.log(
    'open from link:',
    rfcTitle,
    '| pages rendered:',
    await evaluate(`document.querySelectorAll('canvas').length`),
  )
  if (rfcTitle.startsWith('ERROR')) throw new Error(rfcTitle)

  // Back to the landing.
  await evaluate(
    `[...document.querySelectorAll('button')].find(b => b.textContent.includes('Close')).click()`,
  )
  await waitFor(
    `!!document.getElementById('open-pdf-url')`,
    15000,
    'landing again',
  )

  // Flow 1b: a draft's .txt is refused as not a PDF (also shows what a
  // no-CORS host looks like from the browser).
  await evaluate(`(() => {
    const input = document.getElementById('open-pdf-url')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, 'https://www.ietf.org/archive/id/draft-ietf-quic-bit-grease-04.txt')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.form.requestSubmit()
    return true
  })()`)
  console.log(
    'draft txt by link:',
    await waitFor(errorText, 30000, 'txt error'),
  )

  // Flow 1c: a Markdown file by link (raw GitHub serves it with CORS *).
  await evaluate(`(() => {
    const input = document.getElementById('open-pdf-url')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, 'https://raw.githubusercontent.com/estcarisimo/voxnote/main/README.md')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.form.requestSubmit()
    return true
  })()`)
  const mdTitle = await waitFor(
    `(${titleText}) || ((${errorText}) ? 'ERROR: ' + (${errorText}) : '')`,
    60000,
    'Markdown to open',
  )
  console.log(
    'markdown by link:',
    mdTitle,
    '| headings rendered:',
    await evaluate(
      `document.querySelectorAll('.app-body h1, .app-body h2').length`,
    ),
  )
  if (mdTitle.startsWith('ERROR')) throw new Error(mdTitle)
  await evaluate(
    `[...document.querySelectorAll('button')].find(b => b.textContent.includes('Close')).click()`,
  )
  await waitFor(
    `!!document.getElementById('open-pdf-url')`,
    15000,
    'landing after Markdown',
  )

  // Flow 2: Internet-Draft XML through author-tools.
  const { root } = await send('DOM.getDocument')
  const { nodeId } = await send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: 'input[aria-label="Internet-Draft XML"]',
  })
  await send('DOM.setFileInputFiles', { nodeId, files: [XML_PATH] })
  const dialogTitle = await waitFor(
    `document.querySelector('[role="dialog"] h2')?.textContent ?? ''`,
    10000,
    'consent dialog',
  )
  console.log('consent dialog:', dialogTitle)
  console.log(
    'disclosure:',
    await evaluate(`document.querySelector('.dialog-disclosure')?.textContent`),
  )
  await evaluate(
    `[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.startsWith('Send to')).click()`,
  )
  const warnings = await waitFor(
    `(() => { const l = document.querySelector('[aria-label="xml2rfc warnings"]'); if (l) return [...l.children].map(li => li.textContent); const e = ${errorText}; return e ? ['ERROR: ' + e] : null })()`,
    120000,
    'xml2rfc result',
  )
  console.log('xml2rfc warnings:', warnings)
  if (warnings[0]?.startsWith('ERROR')) throw new Error(warnings[0])
  await evaluate(
    `[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent === 'Open the PDF').click()`,
  )
  const draftTitle = await waitFor(titleText, 60000, 'draft to open')
  console.log(
    'open draft:',
    draftTitle,
    '| pages rendered:',
    await evaluate(`document.querySelectorAll('canvas').length`),
  )
  console.log(
    'RESULT: both flows ran in headless Chromium',
    await evaluate('navigator.userAgent'),
  )
} finally {
  ws.close()
  chrome.kill()
}
