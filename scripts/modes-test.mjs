// Compare-mode regression test: Split / Result / Original must each show the
// right layers. Catches the bug where 'Original' hid BOTH images (bad CSS
// selector) and left the clip at 50% (inline style overriding the class).
// Run with:  node scripts/modes-test.mjs   (server must be running on :5173)
import puppeteer from 'puppeteer-core'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const APP_URL = process.env.APP_URL || 'http://localhost:5173/'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  protocolTimeout: 480000,
  userDataDir: mkdtempSync(join(tmpdir(), 'cutout-modes-')),
  args: ['--no-first-run', '--no-sandbox', '--disable-gpu']
})

let failed = 0
let page

try {
  page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 60000 })

  // Warm the model once with a small sample.
  await page.evaluate(async () => {
    const res = await fetch(
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=512&q=80&auto=format&fit=crop',
      { mode: 'cors' }
    )
    const blob = await res.blob()
    window.__cutout.handleFile(new File([blob], 'p.jpg', { type: 'image/jpeg' }))
  })
  await page.waitForSelector('#view-result.view--active', { timeout: 300000 })
  console.log('Model ready, result view active ✔\n')

  async function clickMode(mode) {
    await page.click(`#compareSeg .seg__btn[data-mode="${mode}"]`)
    await new Promise((r) => setTimeout(r, 120))
  }

  async function measure() {
    return page.evaluate(() => {
      const slider = document.getElementById('slider')
      const clip = document.getElementById('beforeClip')
      const handle = document.getElementById('sliderHandle')
      const before = document.getElementById('imgBefore')
      const after = document.getElementById('imgAfter')
      const sw = slider.clientWidth
      const disp = (el) => getComputedStyle(el).display
      const vis = (el) => getComputedStyle(el).visibility
      return {
        sliderH: slider.clientHeight,
        clipPct: (clip.clientWidth / sw) * 100,
        clipVisible: disp(clip) !== 'none',
        handleVisible: disp(handle) !== 'none',
        beforeVisible: disp(before) !== 'none',
        afterVisible: disp(after) !== 'none',
        afterVis: vis(after),
        beforeRectH: before.getBoundingClientRect().height
      }
    })
  }

  const checks = []
  const expect = (name, cond) => {
    checks.push({ name, pass: !!cond })
    if (!cond) failed++
  }

  // --- Split: half original, half result, draggable handle visible
  await clickMode('split')
  let m = await measure()
  console.log('split  :', JSON.stringify(m))
  expect('split: clip ≈ 50%', Math.abs(m.clipPct - 50) < 2)
  expect('split: original visible', m.beforeVisible)
  expect('split: result visible', m.afterVisible)
  expect('split: handle visible', m.handleVisible)
  expect('split: slider has height', m.sliderH > 100)

  // --- Result: only the cutout, no handle
  await clickMode('after')
  m = await measure()
  console.log('result :', JSON.stringify(m))
  expect('result: original layer hidden', !m.clipVisible)
  expect('result: result visible', m.afterVisible)
  expect('result: handle hidden', !m.handleVisible)

  // --- Original: the ORIGINAL image must fill the whole frame.
  // Regression guards:
  //  (a) the result img is hidden via visibility (NOT display:none — that
  //      collapsed the slider to 0 height since it's the only in-flow child)
  //  (b) the slider actually has height and the original fills it
  await clickMode('before')
  m = await measure()
  console.log('original:', JSON.stringify(m))
  expect('original: original img visible', m.beforeVisible)
  expect('original: slider keeps its height (>100px)', m.sliderH > 100)
  expect('original: original fills the frame', m.beforeRectH > m.sliderH * 0.9)
  expect('original: clip ≈ 100%', Math.abs(m.clipPct - 100) < 1)
  expect('original: result not rendered', m.afterVis === 'hidden')
  expect('original: handle hidden', !m.handleVisible)

  // --- Back to Split: position restored, everything visible again
  await clickMode('split')
  m = await measure()
  console.log('split  :', JSON.stringify(m))
  expect('split again: clip ≈ 50%', Math.abs(m.clipPct - 50) < 2)
  expect('split again: both visible', m.beforeVisible && m.afterVisible)

  for (const c of checks) {
    console.log(`${c.pass ? '✅' : '❌'} ${c.name}`)
  }
} catch (err) {
  failed++
  console.error('Test error:', err.message)
} finally {
  try {
    if (page) {
      await page.screenshot({ path: '/tmp/cutout-modes.png' })
    }
    rmSync(browser.userDataDir(), { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
  await browser.close()
}

console.log(failed === 0 ? '\nMODES TEST PASSED ✅' : `\nMODES TEST FAILED (${failed}) ❌`)
process.exit(failed === 0 ? 0 : 1)
