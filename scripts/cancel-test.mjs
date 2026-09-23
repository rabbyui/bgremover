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
// Reuse a profile dir across runs (PROFILE_DIR=...) to skip re-downloading
// the ~95 MB model while debugging; otherwise a throwaway temp dir is used.
const USER_DIR = process.env.PROFILE_DIR || mkdtempSync(join(tmpdir(), 'cutout-cancel-'))
const OWN_DIR = !process.env.PROFILE_DIR

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

  // Capture everything for failure diagnostics.
  const consoleLog = []
  page.on('console', (m) => consoleLog.push(`[console.${m.type()}] ${m.text()}`))
  page.on('pageerror', (e) => consoleLog.push(`[pageerror] ${e.message}`))
  page.on('requestfailed', (r) =>
    consoleLog.push(`[requestfailed] ${r.url().slice(0, 120)} — ${r.failure()?.errorText}`)
  )
  const dumpDiagnostics = async (why) => {
    console.log(`\n🔍 Diagnostics (${why}):`)
    try {
      const st = await page.evaluate(() => ({
        view: document.querySelector('.view--active')?.id,
        sub: document.getElementById('progressSub')?.textContent,
        pct: document.getElementById('progressPct')?.textContent,
        errTitle: document.getElementById('errorTitle')?.textContent,
        errMsg: document.getElementById('errorMsg')?.textContent
      }))
      console.log('   page state:', JSON.stringify(st))
    } catch {}
    for (const line of consoleLog.slice(-15)) console.log('   ' + line)
  }

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

  // Direct DOM click — puppeteer's actionability checks lose races with the
  // fast warm runs (the button can vanish between hit-test and click).
  const clickCancel = () =>
    page.evaluate(() => {
      const b = document.getElementById('cancelBtn')
      if (!b) return false
      b.click()
      return true
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
  /* Deterministic setup: clear the HTTP cache and throttle the network so
   * the ~95 MB download is GUARANTEED to still be in flight when we click
   * (even on a warm profile / fast connection). Unthrottled afterwards. */
  console.log('\n— Scenario 1: cancel during model download')
  const cdp = await page.target().createCDPSession()
  await cdp.send('Network.enable')
  await cdp.send('Network.clearBrowserCache')
  // The library/persisted caches can resolve the model instantly on a warm
  // profile — clear Cache Storage too so the download is genuinely in flight.
  await page.evaluate(() =>
    caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k))))
  )
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 50,
    downloadThroughput: 2 * 1024 * 1024,
    uploadThroughput: 2 * 1024 * 1024
  })
  await uploadSample()
  await page.waitForSelector('#view-progress.view--active', { timeout: 10000 })
  await new Promise((r) => setTimeout(r, 3000)) // download is throttled → still in flight
  if (!(await clickCancel())) throw new Error('cancel button not present in scenario 1')
  await new Promise((r) => setTimeout(r, 400))
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1
  })

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
  /* NOTE: we deliberately do NOT wait for the 'Cutting out' label here —
   * single-threaded WASM inference starves rAF/timers, so label-based waits
   * can time out even though processing is underway. A warm run is quick and
   * may finish within a few seconds, so we click shortly after the progress
   * view appears — that lands mid-decode/inference with the model cached. */
  console.log('\n— Scenario 3: cancel during inference')
  await uploadSample()
  await page.waitForSelector('#view-progress.view--active', { timeout: 10000 })
  await new Promise((r) => setTimeout(r, 400))
  const clicked = await clickCancel()
  if (!clicked) {
    await dumpDiagnostics('cancel button already gone in scenario 3')
    throw new Error('cancel button not present in scenario 3')
  }
  await new Promise((r) => setTimeout(r, 500))
  const stateAtClick = await page.evaluate(() => ({
    view: document.querySelector('.view--active')?.id,
    sub: document.getElementById('progressSub')?.textContent,
    pct: document.getElementById('progressPct')?.textContent
  }))
  console.log('   state right after click:', JSON.stringify(stateAtClick))
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
  if (OWN_DIR) rmSync(USER_DIR, { force: true, recursive: true })
  console.log(failed === 0 ? '\n🎉 ALL CANCEL TESTS PASSED' : `\n💥 ${failed} check(s) failed`)
  process.exit(failed === 0 ? 0 : 1)
}
