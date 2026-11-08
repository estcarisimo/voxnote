// Manual end-to-end check, not part of `npm test`: drives headless Chromium
// over the DevTools protocol against the production build served at APP_URL
// (`npm run build && npm run preview`) and crashes the renderer twice with
// `Page.crash`, checking that the document, the draft and its audio come
// back after each crash:
//
//   1. open a PDF, start a voice comment (fake microphone), type a body,
//      record ~3 s, Stop, crash;
//   2. new tab: Resume, expect the composer with the body, the "Draft
//      restored" notice and the finished recording; Re-record ~3 s and crash
//      while still recording;
//   3. new tab: Resume, expect the partial recording (the chunks written
//      before the crash) to be back and playable; Save it as a comment and
//      check the draft is gone.
//
// Prints what it saw, and every console error or uncaught exception.
//
// BYPASS_SW=1 makes the tabs opened after a crash bypass the service worker.
// Without it, on 2026-11-08 with Chromium 155 headless, the first navigation
// of a tab opened after `Page.crash` never completed (no answer in 20 s,
// twice); with it, every step passed. Not yet explained; see the design note.
// Usage: node scripts/browser-crash-e2e.mjs <path to a PDF>
// Needs /usr/bin/chromium.
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:4173/voxnote/'
const PDF_PATH = process.argv[2]
if (!PDF_PATH) throw new Error('Pass the path to a PDF')
// Not 9333-9335: the other e2e scripts use those, and a busy port would attach
// this script to someone else's browser.
const PORT = Number(process.env.CDP_PORT ?? 9447)

const chrome = spawn(
  '/usr/bin/chromium',
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--window-size=1200,900',
    // A synthetic microphone (a beep), granted without a prompt.
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'voxnote-crash-e2e-'))}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const problems = []

async function devtools(path, init) {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}${path}`, init)
      return await res.json()
    } catch {
      await sleep(200)
    }
  }
  throw new Error('Chromium did not expose DevTools')
}

/** Attaches to a page target; returns helpers bound to it. */
async function attach(target, label) {
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
    } else if (msg.method === 'Runtime.exceptionThrown') {
      problems.push(
        `${label} exception: ` + JSON.stringify(msg.params.exceptionDetails),
      )
    } else if (
      msg.method === 'Runtime.consoleAPICalled' &&
      ['error', 'warning'].includes(msg.params.type)
    ) {
      problems.push(
        `${label} console.${msg.params.type}: ` +
          msg.params.args.map((a) => a.value ?? a.description).join(' '),
      )
    }
  }
  const send = (method, params = {}, timeoutMs = 20000) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (!pending.has(id)) return
        pending.delete(id)
        reject(
          new Error(`${label}: ${method} got no answer in ${timeoutMs} ms`),
        )
      }, timeoutMs)
    })
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (exceptionDetails) {
      throw new Error(
        exceptionDetails.text +
          ' ' +
          JSON.stringify(exceptionDetails.exception),
      )
    }
    return result.value
  }
  const waitFor = async (expression, timeoutMs, what) => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const v = await evaluate(expression)
      if (v) return v
      await sleep(250)
    }
    const seen = await evaluate(
      `(document.querySelector('[role="alert"]')?.textContent ?? '') + ' | ' + document.body.innerText.slice(0, 200)`,
    ).catch((err) => `(page unreadable: ${err.message})`)
    throw new Error(`${label}: timed out waiting for ${what}; page: ${seen}`)
  }
  await send('Page.enable')
  await send('Runtime.enable')
  await send('DOM.enable')
  return { ws, send, evaluate, waitFor }
}

const click = (selectorOrText) => `(() => {
  const b = [...document.querySelectorAll('button')].find(
    (b) => b.textContent.trim() === ${JSON.stringify(selectorOrText)} ||
      b.getAttribute('aria-label') === ${JSON.stringify(selectorOrText)})
  if (!b) throw new Error('no button ' + ${JSON.stringify(selectorOrText)})
  b.click()
  return true
})()`

const typeBody = (text) => `(() => {
  const t = document.querySelector('.comment-composer textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(t, ${JSON.stringify(text)})
  t.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`

/** What IndexedDB holds for crash recovery, without the bytes. */
const recoveryState = `new Promise((resolve, reject) => {
  const r = indexedDB.open('voxnote')
  r.onerror = () => reject(r.error)
  r.onsuccess = () => {
    const db = r.result
    const out = { version: db.version }
    const tx = db.transaction(['drafts', 'documents', 'session', 'annotations'])
    tx.objectStore('drafts').getAll().onsuccess = (e) =>
      (out.drafts = e.target.result.map((d) => ({
        mode: d.mode, body: d.body, anchor: d.anchor.type,
        audio: d.audio && { size: d.audio.blob.size, complete: d.audio.complete,
          mimeType: d.audio.mimeType, durationMs: Math.round(d.audio.durationMs) },
        updatedAt: d.updatedAt })))
    tx.objectStore('documents').getAll().onsuccess = (e) =>
      (out.documents = e.target.result.map((d) => ({ name: d.name, size: d.size,
        mimeType: d.mimeType, openedAt: d.openedAt })))
    tx.objectStore('session').getAll().onsuccess = (e) => (out.session = e.target.result)
    tx.objectStore('annotations').getAll().onsuccess = (e) =>
      (out.annotations = e.target.result.map((a) => ({ kind: a.kind, body: a.body,
        voice: !!a.voice })))
    tx.oncomplete = () => { db.close(); resolve(out) }
  }
})`

/** The composer's replay audio: blob size and whether the browser can play it. */
const composerAudio = `(async () => {
  const el = document.querySelector('.comment-composer audio')
  if (!el) return null
  const blob = await (await fetch(el.src)).blob()
  const probe = new Audio(el.src)
  const playable = await new Promise((resolve) => {
    probe.oncanplay = () => resolve(true)
    probe.onerror = () => resolve('error ' + (probe.error && probe.error.code))
    setTimeout(() => resolve('timeout'), 5000)
  })
  return { size: blob.size, type: blob.type, playable }
})()`

async function crash(page, label) {
  // The renderer dies; the call itself never answers.
  page.send('Page.crash').catch(() => {})
  await sleep(1500)
  page.ws.close()
  console.log(`${label}: renderer crashed with Page.crash`)
}

async function newTab(label) {
  console.log(`${label}: opening a new tab`)
  const target = await devtools(`/json/new?${encodeURIComponent(APP_URL)}`, {
    method: 'PUT',
  })
  console.log(`${label}: target`, target.id, target.url)
  const page = await attach(target, label)
  console.log(`${label}: attached`)
  if (process.env.BYPASS_SW) {
    await page.send('Network.enable')
    await page.send('Network.setBypassServiceWorker', { bypass: true })
  }
  await page.send('Page.navigate', { url: APP_URL })
  await page.waitFor(
    `!!document.querySelector('.open-pdf-button')`,
    15000,
    'landing',
  )
  return page
}

async function resume(page, label) {
  const name = basename(PDF_PATH)
  const offered = await page.waitFor(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.startsWith('Resume '))?.textContent`,
    10000,
    'Resume button',
  )
  console.log(
    `${label}: landing offers "${offered}"; hint:`,
    JSON.stringify(
      await page.evaluate(
        `document.querySelector('.open-pdf-resume .open-pdf-hint').textContent`,
      ),
    ),
  )
  await page.evaluate(click(`Resume ${name}`))
  await page.waitFor(
    `!!document.querySelector('.pdf-page .textLayer span')`,
    20000,
    'PDF text layer after resume',
  )
  await page.waitFor(
    `!!document.querySelector('.comment-composer')`,
    10000,
    'restored composer',
  )
  console.log(
    `${label}: reopened`,
    JSON.stringify(
      await page.evaluate(`document.querySelector('.app-title').textContent`),
    ),
    '| body:',
    JSON.stringify(
      await page.evaluate(
        `document.querySelector('.comment-composer textarea').value`,
      ),
    ),
    '| notice:',
    JSON.stringify(
      await page.evaluate(
        `document.querySelector('.comment-composer [role="status"]')?.textContent ?? null`,
      ),
    ),
  )
  await page.waitFor(
    `!!document.querySelector('.comment-composer audio')`,
    5000,
    'restored recording',
  )
  console.log(
    `${label}: restored audio`,
    JSON.stringify(await page.evaluate(composerAudio)),
  )
}

try {
  // Phase 1: open, dictate, type, Stop, crash.
  const [first] = (await devtools('/json')).filter((t) => t.type === 'page')
  const one = await attach(first, 'tab 1')
  await one.send('Page.navigate', { url: APP_URL })
  await one.waitFor(
    `!!document.querySelector('input[type="file"]')`,
    15000,
    'landing',
  )
  const { root } = await one.send('DOM.getDocument')
  const { nodeId } = await one.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: 'input[type="file"][accept*=".pdf"]',
  })
  await one.send('DOM.setFileInputFiles', { nodeId, files: [PDF_PATH] })
  await one.waitFor(
    `!!document.querySelector('.pdf-page[data-page-number="1"] .textLayer span')`,
    20000,
    'PDF text layer',
  )
  console.log(
    'tab 1: opened',
    JSON.stringify(
      await one.evaluate(`document.querySelector('.app-title').textContent`),
    ),
  )
  const quote = await one.evaluate(`(() => {
    const span = [...document.querySelectorAll('.pdf-page[data-page-number="1"] .textLayer span')]
      .find((s) => s.textContent.trim().length > 12)
    const range = document.createRange()
    range.selectNodeContents(span)
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(range)
    document.dispatchEvent(new PointerEvent('pointerup'))
    return range.toString()
  })()`)
  console.log('tab 1: selected', JSON.stringify(quote))
  await one.waitFor(
    `!!document.querySelector('[role="toolbar"][aria-label="Selection actions"]')`,
    5000,
    'toolbar',
  )
  await one.evaluate(click('Voice comment'))
  await one.waitFor(
    `document.querySelector('.comment-composer-live')?.textContent.includes('Recording')`,
    10000,
    'recording to start',
  )
  await one.evaluate(typeBody('Typed before the crash (e2e).'))
  await sleep(3000)
  await one.evaluate(click('■ Stop'))
  await one.waitFor(
    `!!document.querySelector('.comment-composer audio')`,
    5000,
    'finished recording',
  )
  const before = await one.evaluate(composerAudio)
  console.log('tab 1: recording before crash', JSON.stringify(before))
  await sleep(1500) // past the 400 ms draft debounce
  console.log(
    'tab 1: IndexedDB before crash',
    JSON.stringify(await one.evaluate(recoveryState)),
  )
  await crash(one, 'tab 1')

  // Phase 2: resume, check, re-record and crash mid-recording.
  const two = await newTab('tab 2')
  await resume(two, 'tab 2')
  await two.evaluate(click('Re-record'))
  await two.evaluate(click('● Record'))
  await two.waitFor(
    `document.querySelector('.comment-composer-live')?.textContent.includes('Recording')`,
    10000,
    'second recording to start',
  )
  await sleep(3500)
  console.log(
    'tab 2: IndexedDB while still recording',
    JSON.stringify(await two.evaluate(recoveryState)),
  )
  await crash(two, 'tab 2 (mid-recording)')

  // Phase 3: resume the partial recording, save it.
  const three = await newTab('tab 3')
  await resume(three, 'tab 3')
  await three.evaluate(click('Save'))
  await three.waitFor(
    `!document.querySelector('.comment-composer')`,
    5000,
    'composer to close after Save',
  )
  await sleep(1000)
  console.log(
    'tab 3: IndexedDB after Save',
    JSON.stringify(await three.evaluate(recoveryState)),
  )
  console.log(
    'tab 3: annotations button',
    JSON.stringify(
      await three.evaluate(
        `[...document.querySelectorAll('header button')].find((b) => b.textContent.startsWith('Annotations')).textContent`,
      ),
    ),
  )
  await three.evaluate(click('← Close'))
  await sleep(500)
  console.log(
    'tab 3: after Close, Resume offered:',
    await three.evaluate(
      `[...document.querySelectorAll('button')].some((b) => b.textContent.startsWith('Resume '))`,
    ),
    '| session:',
    JSON.stringify((await three.evaluate(recoveryState)).session),
  )
  console.log(
    'console errors / exceptions:',
    problems.length ? problems : 'none',
  )
} finally {
  chrome.kill()
}
