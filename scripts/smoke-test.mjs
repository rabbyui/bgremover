// E2E smoke test: loads the app headlessly, auto-processes a sample image via
// the real UI path, asserts the result view renders, and verifies the progress
// bar moves in granular steps.
// Run with:  node scripts/smoke-test.mjs   (requires a running dev/preview server)
import puppeteer from 'puppeteer-core'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const APP_URL = process.env.APP_URL || 'http://localhost:5173/'
const errors = []

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  protocolTimeout: 480000,
  // Fresh profile on every run => the AI model is NOT cached => we measure
  // the real cold-start download progress users see on first visit.
  userDataDir: mkdtempSync(join(tmpdir(), 'cutout-e2e-')),
  args: ['--no-first-run', '--no-sandbox', '--disable-gpu']
})

let page
try {
  page = await browser.newPage()
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text())
  })

  await page.setViewport({ width: 1280, height: 900 })
  await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 60000 })

  const title = await page.title()
  const hasDropzone = (await page.$('#dropzone')) !== null
  console.log('Loaded:', title, '| dropzone:', hasDropzone)
  if (!hasDropzone) throw new Error('upload view missing')

  // ---- Progress-bar quality check (cold run: downloads the ~40 MB model)
  // Attach the sampler BEFORE submitting so the download is captured.
  await page.evaluate(() => {
    window.__cutoutProgress = []
    window.__cutoutLabels = []
    const fill = document.getElementById('progressFill')
    const sub = document.getElementById('progressSub')
    // Poll the DOM every 120ms — catches whatever value is on screen.
    window.__cutoutTimer = setInterval(() => {
      window.__cutoutProgress.push(parseFloat(fill.style.width) || 0)
      window.__cutoutLabels.push(sub.textContent)
    }, 120)
  })

  // Drive the pipeline through the UI: fetch a CORS-friendly sample and
  // submit it as a File via the exposed handleFile.
  const submitted = await page.evaluate(
    async () => {
      const res = await fetch(
        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=512&q=80&auto=format&fit=crop',
        { mode: 'cors' }
      )
      const blob = await res.blob()
      const file = new File([blob], 'portrait.jpg', { type: 'image/jpeg' })
      window.__cutout.handleFile(file)
      return file.size
    },
    { timeout: 30000 }
  )
  console.log('Submitted sample to pipeline:', submitted, 'bytes')

  // Wait for the result view (first run downloads the ~40 MB model).
  await page.waitForSelector('#view-result.view--active', { timeout: 300000 })
  await page.evaluate(() => clearInterval(window.__cutoutTimer))
  console.log('Result view active ✔')

  const pctSamples = await page.evaluate(() => window.__cutoutProgress || [])
  const labels = [...new Set(await page.evaluate(() => window.__cutoutLabels || []))]
  const unique = [...new Set(pctSamples.map((v) => Math.round(v)))].sort((a, b) => a - b)
  console.log(
    'Progress samples:',
    pctSamples.length,
    'updates | distinct values:',
    unique.length
  )
  console.log('Sampled values:', unique.join(', '))
  console.log('Stage labels seen:', JSON.stringify(labels))
  if (unique.length < 6) {
    throw new Error(
      `progress bar moved through only ${unique.length} distinct values — not granular`
    )
  }
  const rising = unique.every((v, i) => i === 0 || v >= unique[i - 1])
  if (!rising) throw new Error('progress bar went backwards')
  if (!labels.some((l) => /MB/.test(l))) {
    throw new Error('download stage did not show byte progress (x.x / y.y MB)')
  }
  console.log('Progress bar granularity ✔')
  // ----------------------------------------------------------------------

  const info = await page.evaluate(() => {
    const after = document.getElementById('imgAfter')
    return {
      note: document.getElementById('resultNote').textContent,
      afterSrc: (after.src || '').slice(0, 30),
      title: document.title
    }
  })
  console.log('Result info:', JSON.stringify(info))

  if (!info.afterSrc.startsWith('blob:')) throw new Error('result image missing')
  if (!/Done/.test(info.title)) throw new Error('title did not update to Done')

  await page.screenshot({ path: '/tmp/cutout-smoke.png' })
  console.log('Screenshot: /tmp/cutout-smoke.png')
} catch (err) {
  try {
    if (page) {
      await page.screenshot({ path: '/tmp/cutout-fail.png' })
      const dbg = await page.evaluate(() => ({
        activeView: document.querySelector('.view--active')?.id || 'none',
        pct: document.getElementById('progressPct')?.textContent,
        sub: document.getElementById('progressSub')?.textContent,
        lastProgress: (window.__cutoutProgress || []).slice(-8)
      }))
      console.error('DIAGNOSTICS:', JSON.stringify(dbg, null, 2))
      console.error('Failure screenshot: /tmp/cutout-fail.png')
    }
  } catch {
    /* diagnostics are best-effort */
  }
  throw err
} finally {
  try {
    rmSync(browser.userDataDir(), { recursive: true, force: true })
  } catch {
    /* best-effort cleanup */
  }
  await browser.close()
}

if (errors.length) {
  console.log('Page errors:', errors)
  process.exit(2)
}
console.log('SMOKE TEST PASSED ✅')
