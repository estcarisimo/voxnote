// Opens a PDF, scrolls to TARGET, reloads, resumes, and reports the page in view.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const [APP_URL, FILE, TARGET = '50'] = process.argv.slice(2)
const dir = mkdtempSync(join(tmpdir(), 'vx-resume-'))
const chrome = spawn(
  '/usr/bin/chromium',
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--window-size=1180,820',
    '--remote-debugging-port=0',
    `--user-data-dir=${dir}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let port
for (let i = 0; i < 50 && !port; i++) {
  try {
    port = readFileSync(join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]
  } catch {
    await sleep(200)
  }
}
const t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(
  (x) => x.type === 'page',
)
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 1
const pend = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id)
    pend.delete(m.id)
    m.error ? p.rej(new Error(m.error.message)) : p.res(m.result)
  }
}
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = id++
    pend.set(i, { res, rej })
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result.value
}
const waitFor = async (e, ms, what) => {
  const s = Date.now()
  while (Date.now() - s < ms) {
    const v = await ev(e)
    if (v) return v
    await sleep(100)
  }
  throw new Error('timeout ' + what)
}
const visible = `(() => { const v = document.querySelector('.pdf-viewer'); const b = v.getBoundingClientRect(); const line = b.top + b.height / 3; for (const el of v.querySelectorAll('[data-page-number]')) if (el.getBoundingClientRect().bottom > line) return Number(el.dataset.pageNumber); return null })()`
try {
  await send('Page.enable')
  await send('DOM.enable')
  await send('Page.navigate', { url: APP_URL })
  await waitFor(
    `!!document.querySelector('input[type="file"]')`,
    15000,
    'landing',
  )
  await sleep(1500)
  for (let a = 0; ; a++) {
    try {
      const { root } = await send('DOM.getDocument')
      const { nodeId } = await send('DOM.querySelector', {
        nodeId: root.nodeId,
        selector: 'input[type="file"][accept*=".md"]',
      })
      await send('DOM.setFileInputFiles', { nodeId, files: [FILE] })
      break
    } catch (e) {
      if (a > 3) throw e
      await sleep(1000)
    }
  }
  await waitFor(
    `!!document.querySelector('.pdf-page .textLayer span')`,
    60000,
    'render',
  )
  await sleep(3000)
  await ev(
    `document.querySelector('[data-page-number="${TARGET}"]').scrollIntoView({block:'start'})`,
  )
  await sleep(500)
  const before = await ev(visible)
  await sleep(2500)
  await send('Page.reload')
  await waitFor(
    `!!document.querySelector('.recent-documents-interrupted button')`,
    20000,
    'resume row',
  )
  await ev(
    `document.querySelector('.recent-documents-interrupted button').click()`,
  )
  await waitFor(`!!document.querySelector('.pdf-viewer')`, 20000, 'viewer')
  await sleep(5000)
  console.log(
    JSON.stringify({
      app: APP_URL,
      target: Number(TARGET),
      inViewBeforeReload: before,
      inViewAfterResume: await ev(visible),
    }),
  )
} finally {
  ws.close()
  chrome.kill()
}
