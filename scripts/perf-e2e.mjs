// Manual performance check, not part of `npm test`: drives headless Chromium
// over the DevTools protocol against the production build served at APP_URL
// (`npm run build && npm run preview`) and measures main-thread blocking
// while reviewing a large document. For each step it prints the long tasks
// (PerformanceObserver 'longtask', tasks over 50 ms), the longest gap between
// animation frames, and the memory held by page canvases.
//
// Usage: node scripts/perf-e2e.mjs <file.pdf | file.md> [label]
// Env: APP_URL (default http://[::1]:4173/voxnote/), DPR (default 2),
//      WIDTH x HEIGHT of the window (default 1180 x 820, an iPad Air).
// Needs /usr/bin/chromium.
import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP_URL = process.env.APP_URL ?? 'http://[::1]:4173/voxnote/'
const FILE = process.argv[2]
if (!FILE) throw new Error('Pass the path to a .pdf or .md file')
const LABEL = process.argv[3] ?? ''
const IS_PDF = FILE.toLowerCase().endsWith('.pdf')
const DPR = Number(process.env.DPR ?? 2)
const WIDTH = Number(process.env.WIDTH ?? 1180)
const HEIGHT = Number(process.env.HEIGHT ?? 820)
const HIGHLIGHTS = Number(process.env.HIGHLIGHTS ?? 30)
// PROFILE=<step name prefix>: CPU-profile that step and print the functions
// with the most self time, to see what the long tasks are made of.
const PROFILE = process.env.PROFILE ?? ''
const PORT = 9335
const DOWNLOADS = mkdtempSync(join(tmpdir(), 'voxnote-perf-downloads-'))

const chrome = spawn(
  '/usr/bin/chromium',
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--enable-precise-memory-info',
    `--window-size=${WIDTH},${HEIGHT}`,
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'voxnote-perf-'))}`,
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

const target = (await targets()).find((t) => t.type === 'page')
const ws = new WebSocket(target.webSocketDebuggerUrl)
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
    msg.params.type === 'error'
  ) {
    pageProblems.push(
      'console.error: ' +
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
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

// Installed before any page script: records long tasks and frame gaps.
const PROBE = `
  window.__lt = []
  window.__gaps = []
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__lt.push([e.startTime, e.duration])
  }).observe({ type: 'longtask', buffered: true })
  let last = performance.now()
  const tick = (t) => {
    if (t - last > 50) window.__gaps.push([last, t - last])
    last = t
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
`

const now = () => evaluate('performance.now()')

/** Waits until no long task has started for `quietMs`, up to `maxMs`. */
async function settle(quietMs = 1500, maxMs = 120000) {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    const idle = await evaluate(`(() => {
      const t = performance.now()
      const last = window.__lt.at(-1)
      return !last || t - (last[0] + last[1]) > ${quietMs}
    })()`)
    if (idle) return
    await sleep(200)
  }
  throw new Error('Main thread never went quiet')
}

const memory = () =>
  evaluate(`(() => {
    let canvasBytes = 0, canvases = 0
    for (const c of document.querySelectorAll('canvas')) {
      if (c.width && c.height) { canvases++; canvasBytes += c.width * c.height * 4 }
    }
    return {
      canvases,
      canvasMB: +(canvasBytes / 2 ** 20).toFixed(1),
      jsHeapMB: +(performance.memory.usedJSHeapSize / 2 ** 20).toFixed(1),
      domNodes: document.getElementsByTagName('*').length,
    }
  })()`)

const results = []

function printProfile({ nodes, samples, timeDeltas }) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const self = new Map()
  samples.forEach((id, i) => {
    const { functionName, url, lineNumber } = byId.get(id).callFrame
    const key = `${functionName || '(anonymous)'} ${url.split('/').pop()}:${lineNumber}`
    self.set(key, (self.get(key) ?? 0) + timeDeltas[i] / 1000)
  })
  const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)
  console.log('PROFILE (self ms)')
  for (const [key, ms] of top)
    console.log(String(Math.round(ms)).padStart(8), key)
}

async function step(name, fn) {
  const profiling = PROFILE && name.startsWith(PROFILE)
  if (profiling) {
    await send('Profiler.enable')
    await send('Profiler.setSamplingInterval', { interval: 500 })
    await send('Profiler.start')
  }
  const from = await now()
  const wall = Date.now()
  const extra = (await fn()) ?? {}
  const elapsedMs = Date.now() - wall
  await settle()
  if (profiling) printProfile((await send('Profiler.stop')).profile)
  const to = await now()
  const stats = await evaluate(`(() => {
    const lt = window.__lt.filter(([s]) => s >= ${from} && s <= ${to})
    const gaps = window.__gaps.filter(([s]) => s >= ${from} && s <= ${to})
    return {
      longTasks: lt.length,
      longTaskMs: Math.round(lt.reduce((a, [, d]) => a + d, 0)),
      maxTaskMs: Math.round(Math.max(0, ...lt.map(([, d]) => d))),
      maxFrameGapMs: Math.round(Math.max(0, ...gaps.map(([, d]) => d))),
    }
  })()`)
  const row = { step: name, elapsedMs, ...stats, ...(await memory()), ...extra }
  results.push(row)
  console.log(JSON.stringify(row))
}

const viewer = IS_PDF ? '.pdf-viewer' : '.markdown-viewer'
const textRoot = IS_PDF ? '.textLayer' : '.markdown-view'

/** Scrolls the viewer top to bottom and back in `steps` jumps per frame. */
const scrollThrough = (steps) =>
  evaluate(`new Promise((resolve) => {
    const v = document.querySelector('${viewer}')
    const max = v.scrollHeight - v.clientHeight
    const path = []
    for (let i = 0; i <= ${steps}; i++) path.push((max * i) / ${steps})
    for (let i = ${steps}; i >= 0; i--) path.push((max * i) / ${steps})
    let i = 0
    const next = () => {
      if (i >= path.length) return resolve(path.length)
      v.scrollTop = path[i++]
      requestAnimationFrame(next)
    }
    requestAnimationFrame(next)
  })`)

/** Selects a run of characters inside the n-th visible text container. */
const selectSomeText = (n) =>
  evaluate(`(() => {
    const v = document.querySelector('${viewer}')
    const box = v.getBoundingClientRect()
    const nodes = []
    const walker = document.createTreeWalker(
      document.querySelector('${viewer}'), NodeFilter.SHOW_TEXT)
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (t.data.trim().length < 20) continue
      if (!t.parentElement.closest('${textRoot}')) continue
      const r = t.parentElement.getBoundingClientRect()
      if (r.top > box.top + 40 && r.bottom < box.bottom - 40) nodes.push(t)
    }
    const text = nodes[${n} % Math.max(1, nodes.length)]
    if (!text) return ''
    const range = document.createRange()
    range.setStart(text, 2)
    range.setEnd(text, Math.min(text.data.length, 18))
    const s = window.getSelection()
    s.removeAllRanges()
    s.addRange(range)
    return range.toString()
  })()`)

const toolbar = `!!document.querySelector('[role="toolbar"][aria-label="Selection actions"]')`

try {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('DOM.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: DPR,
    mobile: false,
  })
  await send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: DOWNLOADS,
  })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE })
  await send('Page.navigate', { url: APP_URL })
  await waitFor(
    `!!document.querySelector('input[type="file"]')`,
    15000,
    'landing',
  )
  await settle()
  const ua = await evaluate('navigator.userAgent')
  console.log(
    JSON.stringify({
      label: LABEL,
      file: FILE,
      dpr: DPR,
      width: WIDTH,
      height: HEIGHT,
      ua,
      utc: new Date().toISOString(),
    }),
  )

  await step('open', async () => {
    const { root } = await send('DOM.getDocument')
    const { nodeId } = await send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: 'input[type="file"][accept*=".md"]',
    })
    const t0 = Date.now()
    await send('DOM.setFileInputFiles', { nodeId, files: [FILE] })
    await waitFor(`!!document.querySelector('.app-title')`, 60000, 'document')
    const titleMs = Date.now() - t0
    // First readable page: a canvas with pixels and a text layer with spans
    // (PDF), or the rendered Markdown.
    await waitFor(
      IS_PDF
        ? `[...document.querySelectorAll('.pdf-page')].some(p => p.querySelector('canvas').width > 0 && p.querySelector('.textLayer span'))`
        : `!!document.querySelector('.markdown-view *')`,
      120000,
      'first page',
    )
    return { titleMs, firstPageMs: Date.now() - t0 }
  })

  // A click on the first page during load: how long until the page answers?
  await step('input latency after open', async () => {
    const t0 = Date.now()
    await evaluate(`new Promise(r => setTimeout(r, 0))`)
    return { evalRoundTripMs: Date.now() - t0 }
  })

  await step('scroll fast through all pages', async () => {
    const frames = await scrollThrough(IS_PDF ? 150 : 100)
    if (!IS_PDF) return { frames }
    // Back at the top: how long until the first page is readable again?
    const t0 = Date.now()
    await waitFor(
      `(() => { const p = document.querySelector('.pdf-page[data-page-number="1"]'); return p.querySelector('canvas').width > 0 && !!p.querySelector('.textLayer span') })()`,
      30000,
      'page 1 after the scroll',
    )
    return { frames, page1ReadyMs: Date.now() - t0 }
  })

  if (IS_PDF) {
    await step('resize window', async () => {
      await send('Emulation.setDeviceMetricsOverride', {
        width: WIDTH - 200,
        height: HEIGHT,
        deviceScaleFactor: DPR,
        mobile: false,
      })
      await sleep(300)
    })
    await send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: DPR,
      mobile: false,
    })
    await settle()

    await step('pen-select text', async () => {
      await evaluate(
        `document.querySelector('.pdf-page[data-page-number="2"]').scrollIntoView()`,
      )
      await waitFor(
        `!!document.querySelector('.pdf-page[data-page-number="2"] .textLayer span')`,
        30000,
        'page 2 text layer',
      )
      await settle()
      const span = await evaluate(`(() => {
        const s = [...document.querySelectorAll('.pdf-page[data-page-number="2"] .textLayer span')]
          .find(s => s.textContent.trim().length > 30)
        s.scrollIntoView({ block: 'center' })
        const r = s.getBoundingClientRect()
        return { x: r.left + 3, y: r.top + r.height / 2, w: r.width }
      })()`)
      await sleep(300)
      const base = { pointerType: 'pen', button: 'left', buttons: 1 }
      await send('Input.dispatchMouseEvent', {
        ...base,
        type: 'mouseMoved',
        x: span.x,
        y: span.y,
        buttons: 0,
      })
      await send('Input.dispatchMouseEvent', {
        ...base,
        type: 'mousePressed',
        x: span.x,
        y: span.y,
        clickCount: 1,
      })
      for (let i = 1; i <= 20; i++) {
        await send('Input.dispatchMouseEvent', {
          ...base,
          type: 'mouseMoved',
          x: span.x + (span.w * i) / 22,
          y: span.y,
        })
      }
      const t0 = Date.now()
      await send('Input.dispatchMouseEvent', {
        ...base,
        type: 'mouseReleased',
        x: span.x + span.w * 0.9,
        y: span.y,
        clickCount: 1,
        buttons: 0,
      })
      await waitFor(toolbar, 5000, 'toolbar after pen')
      return {
        toolbarAfterLiftMs: Date.now() - t0,
        selected: await evaluate('window.getSelection().toString().length'),
      }
    })
  }

  await step(`save ${HIGHLIGHTS} highlights`, async () => {
    const perSave = []
    for (let i = 0; i < HIGHLIGHTS; i++) {
      // Spread the highlights over the document.
      await evaluate(`(() => {
        const v = document.querySelector('${viewer}')
        v.scrollTop = (v.scrollHeight - v.clientHeight) * ${i / HIGHLIGHTS}
      })()`)
      // Pages render as they come near the screen: wait for their text.
      let text = ''
      for (let tries = 0; !text && tries < 100; tries++) {
        await sleep(150)
        text = await selectSomeText(i)
      }
      if (!text) throw new Error(`No visible text to select (round ${i})`)
      await waitFor(toolbar, 10000, 'toolbar')
      const t0 = await now()
      await evaluate(
        `[...document.querySelectorAll('[aria-label="Selection actions"] button')].find(b => b.textContent === 'Highlight').click()`,
      )
      await waitFor(`!${toolbar}`, 5000, 'toolbar to close')
      perSave.push(Math.round((await now()) - t0))
    }
    await waitFor(
      `[...document.querySelectorAll('header button')].some(b => b.textContent.includes('${HIGHLIGHTS}'))`,
      10000,
      'annotation count',
    ).catch(() => {})
    return {
      maxSaveMs: Math.max(...perSave),
      medianSaveMs: perSave.sort((a, b) => a - b)[perSave.length >> 1],
    }
  })

  await step(IS_PDF ? 'export PDF' : 'export Markdown', async () => {
    const t0 = Date.now()
    await evaluate(
      `[...document.querySelectorAll('[aria-label="Export"] button')].find(b => b.textContent.includes('${IS_PDF ? 'PDF' : 'Markdown'}')).click()`,
    )
    const start = Date.now()
    while (
      readdirSync(DOWNLOADS).filter((f) => !f.endsWith('.crdownload'))
        .length === 0
    ) {
      if (Date.now() - start > 120000) throw new Error('No download')
      await sleep(100)
    }
    return { downloadMs: Date.now() - t0, file: readdirSync(DOWNLOADS)[0] }
  })

  console.log('SUMMARY', LABEL)
  console.table(results)
  if (pageProblems.length) console.log('PAGE PROBLEMS', pageProblems)
} finally {
  ws.close()
  chrome.kill()
}
