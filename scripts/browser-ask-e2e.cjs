// Manual end-to-end check, not part of `npm test`: drives headless Chromium
// (Playwright) against the production build served by
// `npm run build && npx vite preview --port 4173`, with a local text model
// server at localhost:11434 intercepted, through "Save and ask…" on a
// Markdown document. Prints what it saw.
// Usage: node scripts/browser-ask-e2e.cjs
const { chromium } = require('playwright')
const fs = require('fs')
const os = require('os')
const path = require('path')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voxnote-ask-e2e-'))
fs.writeFileSync(
  path.join(dir, 'doc.md'),
  [
    '# Quantum note',
    'Coherence matters for every gate we run.',
    'The qubit decoheres within 3 µs under the stated bias, which the authors call T2 star.',
    'A third paragraph closes the section.',
  ].join('\n\n') + '\n',
)
;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const problems = []
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push('console: ' + m.text())
  })
  const sent = []
  await page.route(
    'http://localhost:11434/v1/chat/completions',
    async (route) => {
      if (route.request().method() === 'OPTIONS')
        return route.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': '*',
          },
        })
      sent.push(JSON.parse(route.request().postData()))
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
        },
        body: JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  'T2* is the dephasing time (general knowledge, not stated in the manuscript).',
              },
              finish_reason: 'stop',
            },
          ],
        }),
      })
    },
  )
  await page.addInitScript(() => {
    localStorage.setItem(
      'voxnote.text.settings',
      JSON.stringify({
        provider: 'local-text',
        model: 'llama3.2:3b',
        local: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.2:3b' },
      }),
    )
  })
  await page.goto('http://localhost:4173/voxnote/')
  await page.setInputFiles(
    'input[type="file"][accept*=".md"]',
    path.join(dir, 'doc.md'),
  )
  await page.waitForSelector('.markdown-view')
  // Select "T2 star" in block 3.
  await page.evaluate(() => {
    const block = document.querySelector('[data-block="3"]')
    const t = document.createTreeWalker(block, NodeFilter.SHOW_TEXT).nextNode()
    const i = t.textContent.indexOf('T2 star')
    const r = document.createRange()
    r.setStart(t, i)
    r.setEnd(t, i + 7)
    const s = getSelection()
    s.removeAllRanges()
    s.addRange(r)
    document.dispatchEvent(new Event('selectionchange'))
  })
  await page
    .getByRole('toolbar', { name: 'Selection actions' })
    .getByRole('button', { name: 'Comment', exact: true })
    .click()
  await page
    .getByRole('textbox', { name: 'Comment' })
    .fill('What does T2 star mean here?')
  await page.getByRole('button', { name: 'Save and ask…' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  console.log('dialog title:', await dialog.locator('h2').textContent())
  console.log(
    'disclosure:',
    await dialog.locator('.dialog-disclosure').textContent(),
  )
  console.log('requests before Send:', sent.length)
  await dialog.getByRole('checkbox').check()
  console.log(
    'disclosure (with context):',
    await dialog.locator('.dialog-disclosure').textContent(),
  )
  await dialog.getByRole('button', { name: /^Send to/ }).click()
  await dialog.getByRole('button', { name: 'Keep' }).waitFor()
  console.log('answer title:', await dialog.locator('h2').textContent())
  await page.screenshot({ path: path.join(dir, 'answer-dialog.png') })
  await dialog.getByRole('button', { name: 'Keep' }).click()
  console.log('requests:', sent.length, 'model:', sent[0].model)
  console.log('system starts:', sent[0].messages[0].content.slice(0, 60))
  console.log('user message:\n' + sent[0].messages[1].content)
  // Sidebar
  const annotationsBtn = page.locator('header button', {
    hasText: /^Annotations/,
  })
  if (
    (await annotationsBtn.count()) &&
    !(await page.locator('.annotation-list').count())
  )
    await annotationsBtn.click()
  await page.locator('.annotation-list-answers summary').click()
  console.log(
    'answers summary:',
    await page.locator('.annotation-list-answers summary').textContent(),
  )
  console.log(
    'visibility:',
    await page.locator('.annotation-list-visibility').first().textContent(),
  )
  console.log(
    'ask again:',
    await page.getByRole('button', { name: 'Ask again…' }).count(),
  )
  await page.screenshot({ path: path.join(dir, 'sidebar.png') })
  // Reload: the answer persists.
  await page.reload()
  await page.setInputFiles(
    'input[type="file"][accept*=".md"]',
    path.join(dir, 'doc.md'),
  )
  await page.waitForSelector('.markdown-view')
  if (
    (await annotationsBtn.count()) &&
    !(await page.locator('.annotation-list').count())
  )
    await annotationsBtn.click()
  console.log(
    'after reload, answers:',
    await page.locator('.annotation-list-answers summary').textContent(),
  )
  console.log('problems:', JSON.stringify(problems))
  await browser.close()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
