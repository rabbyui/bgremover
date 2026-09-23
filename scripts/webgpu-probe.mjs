// One-off probe: does headless Chrome (with WebGPU flags) expose a working
// WebGPU adapter? If yes, we can e2e-test the device:'gpu' + proxyToWorker
// path instead of only the CPU fallback.
import puppeteer from 'puppeteer-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const FLAG_SETS = [
  ['--enable-unsafe-webgpu'],
  ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
  ['--enable-unsafe-webgpu', '--use-angle=metal'],
  ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal']
]

for (const args of FLAG_SETS) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    protocolTimeout: 60000,
    userDataDir: mkdtempSync(join(tmpdir(), 'gpu-probe-')),
    args: [...args, '--no-first-run', '--no-sandbox', '--window-size=400,300']
  })
  try {
    const page = await browser.newPage()
    // navigator.gpu is only exposed in secure contexts; about:blank may not
    // qualify, so probe against localhost (treated as secure).
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
    const r = await page.evaluate(async () => {
      if (!('gpu' in navigator)) return { api: false }
      try {
        const adapter = await navigator.gpu.requestAdapter()
        return { api: true, adapter: !!adapter, info: adapter ? await adapter.requestAdapterInfo?.() : null }
      } catch (e) {
        return { api: true, adapter: false, err: String(e) }
      }
    })
    console.log(args.join(' ').padEnd(60), '→', JSON.stringify(r))
  } catch (e) {
    console.log(args.join(' ').padEnd(60), '→ LAUNCH FAIL:', e.message.slice(0, 80))
  } finally {
    await browser.close()
  }
}
