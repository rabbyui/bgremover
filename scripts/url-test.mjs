// URL-loading feature test: covers the direct-fetch path, the CORS-blocked →
// proxy-fallback path, and the invalid-URL error path.
// Run with:  node scripts/url-test.mjs   (server must be running on :5173)
import puppeteer from 'puppeteer-core'

const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const APP_URL = process.env.APP_URL || 'http://localhost:5173/'

const CASES = [
  {
    name: 'CORS-friendly image (unsplash)',
    url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=512&q=80&auto=format&fit=crop',
    expect: 'success'
  },
  {
    name: 'CORS-blocked image (httpbin) — must fall back to proxy',
    url: 'https://httpbin.org/image/png',
    expect: 'success'
  },
  {
    name: 'Invalid URL — must show error toast, not crash',
    url: 'https://nonexistent.invalid/image.jpg',
    expect: 'error'
  }
]

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-first-run', '--no-sandbox', '--disable-gpu']
})

let failed = 0

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })

  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

  // Warm up the model ONCE so each case only tests URL loading, not the
  // 40 MB download (speed + flakiness).
  await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 60000 })
  await page.evaluate(async () => {
    const res = await fetch(
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=256&q=60&auto=format&fit=crop',
      { mode: 'cors' }
    )
    const blob = await res.blob()
    window.__cutout.handleFile(
      new File([blob], 'warm.jpg', { type: 'image/jpeg' })
    )
  })
  await page.waitForSelector('#view-result.view--active', { timeout: 300000 })
  console.log('Model warmed up ✔\n')

  for (const c of CASES) {
    await page.evaluate(() => {
      document.getElementById('view-result').classList.remove('view--active')
      document.getElementById('view-upload').classList.add('view--active')
      document.getElementById('urlInput').value = ''
    })

    // Type into the real input and click the real button — no API bypass.
    await page.type('#urlInput', c.url)
    await page.click('#urlGoBtn')

    const outcome = await page.evaluate(
      (expect) =>
        new Promise((resolve) => {
          const started = Date.now()
          const iv = setInterval(() => {
            const resultActive = document
              .getElementById('view-result')
              .classList.contains('view--active')
            const toastVisible = document
              .getElementById('toast')
              .classList.contains('is-visible')
            if (resultActive) {
              clearInterval(iv)
              resolve('success')
            } else if (toastVisible && expect === 'error') {
              clearInterval(iv)
              resolve('error')
            } else if (Date.now() - started > 60000) {
              clearInterval(iv)
              resolve('timeout')
            }
          }, 250)
        }),
      c.expect
    )

    const pass = outcome === c.expect
    if (!pass) failed++
    console.log(
      `${pass ? '✅' : '❌'} ${c.name} → ${outcome}${pass ? '' : ` (expected ${c.expect})`}`
    )
  }

  if (errors.length) {
    failed++
    console.log('Page errors:', errors)
  }
} finally {
  await browser.close()
}

console.log(failed === 0 ? '\nURL TESTS PASSED ✅' : `\nURL TESTS FAILED (${failed}) ❌`)
process.exit(failed === 0 ? 0 : 1)
