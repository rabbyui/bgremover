// Cancel-feature regression test. Four scenarios, ordered so the ~95 MB cold
// download happens only ONCE (an aborted download leaves the model uncached):
//   1. Cancel during the cold model download → the library's fetch is
//      hard-aborted (AbortController signal fires), UI returns to upload,
//      and no result ever appears.
//   2. Fresh run after that cancel → completes normally (and caches model).
//   3. Cancel during inference (model now cached) → result discarded.
//   4. Fresh run again → completes (next run after a cancel still works).
// Run with:  node scripts/cancel-test.mjs   (server must be running on :5173)
import puppeteer from 'puppeteer-core'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const APP_URL = process.env.APP_URL || 'http://localhost:5173/'
const USER_DIR = mkdtempSync(join(tmpdir(), 'cutout-cancel-'))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  protocolTimeout: 540000,
  userDataDir: USER_DIR,
  args: ['--no-first-run', '--no-sandbox', '--disable-gpu']
})

let failed = 0
const check = (label, cond) => {
  console.log((cond ? '✅' : '❌') + ' ' + label)
  if (!cond) failed++
}

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 60000 })

  const uploadSample = () =>
    page.evaluate(async () => {
      const res = await fetch(
        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=512&q=80&auto=format&fit=crop',
        { mode: 'cors' }
      )
      const blob = await res.blob()
      window.__cutout.handleFile(new File([blob], 'p.jpg', { type: 'image/jpeg' }))
    })

  const activeView = () =>
    page.evaluate(() => {
      const el = document.querySelector('.view--active')
      return el ? el.id.replace('view-', '') : null
    })

  // Count aborts of any fetch that carries our AbortController signal.
  await page.evaluate(() => {
    window.__aborted = 0
    const orig = window.fetch
    window.fetch = function (url, opts) {
      if (opts && opts.signal) {
        opts.signal.addEventListener('abort', () => window.__aborted++)
      }
      return orig.call(this, url, opts)
    }
  })

  // ---- Scenario 1: cancel during the cold model download -------------
  console.log('\n— Scenario 1: cancel during model download')
  await uploadSample()
  await page.waitForSelector('#view-progress.view--active', { timeout: 10000 })
  await new Promise((r) => setTimeout(r, 1500)) // let the download start
  await page.click('#cancelBtn')
  await new Promise((r) => setTimeout(r, 400))

  check('UI returns to upload view immediately', (await activeView()) === 'upload')
  check(
    'in-flight fetches were hard-aborted (signal fired)',
    await page.evaluate(() => window.__aborted > 0)
  )
  await new Promise((r) => setTimeout(r, 3000))
  check('no result view after cancelling download', (await activeView()) === 'upload')

  // ---- Scenario 2: fresh run completes (and caches the model) --------
  console.log('\n— Scenario 2: fresh run after cancelling')
  await uploadSample()
  await page.waitForSelector('#view-result.view--active', { timeout: 420000 })
  check('fresh run completes normally', (await activeView()) === 'result')
  check(
    'result image is present',
    await page.evaluate(() => {
      const img = document.getElementById('imgAfter')
      return !!img && img.src.length > 0
    })
  )

  // ---- Scenario 3: cancel during inference (model cached → fast) ----
  console.log('\n— Scenario 3: cancel during inference')
  await uploadSample()
  await page.waitForFunction(
    () => document.getElementById('progressSub').textContent.includes('Cutting out'),
    { timeout: 120000 }
  )
  await page.click('#cancelBtn')
  await new Promise((r) => setTimeout(r, 500))
  check('UI returns to upload view', (await activeView()) === 'upload')
  await new Promise((r) => setTimeout(r, 4000))
  check('result view never appears after cancelling inference', (await activeView()) === 'upload')

  // ---- Scenario 4: next run after an inference cancel still works ----
  console.log('\n— Scenario 4: next run after inference cancel')
  await uploadSample()
  await page.waitForSelector('#view-result.view--active', { timeout: 300000 })
  check('next run completes normally', (await activeView()) === 'result')
} catch (err) {
  console.error('\n💥 Test crashed:', err.message)
  failed++
} finally {
  await browser.close()
  rmSync(USER_DIR, { force: true, recursive: true })
  console.log(failed === 0 ? '\n🎉 ALL CANCEL TESTS PASSED' : `\n💥 ${failed} check(s) failed`)
  process.exit(failed === 0 ? 0 : 1)
}
