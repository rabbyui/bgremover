// One-off diagnostic: measure slider height per compare mode.
// Run with:  node scripts/debug-original.mjs   (server must be running on :5173)
import puppeteer from 'puppeteer-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const APP_URL = process.env.APP_URL || 'http://localhost:5173/'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  protocolTimeout: 480000,
  userDataDir: process.env.PROFILE_DIR || mkdtempSync(join(tmpdir(), 'cutout-dbg-')),
  args: ['--no-first-run', '--no-sandbox', '--disable-gpu']
})

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 60000 })

  await page.evaluate(async () => {
    const res = await fetch(
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=512&q=80&auto=format&fit=crop',
      { mode: 'cors' }
    )
    const blob = await res.blob()
    window.__cutout.handleFile(new File([blob], 'p.jpg', { type: 'image/jpeg' }))
  })
  await page.waitForSelector('#view-result.view--active', { timeout: 300000 })

  for (const mode of ['split', 'after', 'before']) {
    await page.click(`#compareSeg .seg__btn[data-mode="${mode}"]`)
    await new Promise((r) => setTimeout(r, 150))
    const m = await page.evaluate(() => {
      const s = document.getElementById('slider')
      const before = document.getElementById('imgBefore')
      const after = document.getElementById('imgAfter')
      return {
        sliderH: s.clientHeight,
        sliderW: s.clientWidth,
        beforeDisplay: getComputedStyle(before).display,
        afterDisplay: getComputedStyle(after).display,
        beforeRectH: before.getBoundingClientRect().height
      }
    })
    console.log(`${mode.padEnd(7)} slider: ${m.sliderW}×${m.sliderH}px | imgBefore display=${m.beforeDisplay} rectH=${Math.round(m.beforeRectH)} | imgAfter display=${m.afterDisplay}`)
  }
  await page.screenshot({ path: '/tmp/original-mode.png' })
  console.log('\nscreenshot: /tmp/original-mode.png')
} finally {
  await browser.close()
}
