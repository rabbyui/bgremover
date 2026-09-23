/* Cutout — in-browser background remover
 * Uses @imgly/background-removal (ISNet model via onnxruntime-web).
 * Everything runs client-side: the AI model is fetched once (and cached),
 * images are processed locally and never uploaded anywhere.
 */
import { removeBackground } from '@imgly/background-removal'

/* ---------- Tiny DOM helpers ---------- */
const $ = (id) => document.getElementById(id)

const views = ['upload', 'progress', 'result', 'error']

const DEFAULT_TITLE = document.title

function show(name) {
  for (const v of views) {
    $('view-' + v).classList.toggle('view--active', v === name)
  }
  document.title =
    name === 'progress' ? 'Processing… — Cutout'
    : name === 'result' ? '✓ Done — Cutout'
    : name === 'error' ? '⚠ Error — Cutout'
    : DEFAULT_TITLE
  window.scrollTo({ top: 0 })
}

let toastTimer = null
function toast(msg, ms = 2600) {
  const el = $('toast')
  el.textContent = msg
  el.classList.add('is-visible')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), ms)
}

function showError(title, msg) {
  $('errorTitle').textContent = title
  $('errorMsg').textContent = msg
  show('error')
}

/* ---------- State ---------- */
const state = {
  originalBlob: null, // Blob | null — original image
  cutoutBlob: null, // Blob | null — PNG with alpha
  originalURL: null, // object URL for <img>
  cutoutURL: null, // object URL for <img>
  bgColor: 'transparent', // 'transparent' | '#rrggbb'
  mode: 'split', // 'split' | 'after' | 'before'
  downloadURL: null,
  downloadName: 'cutout.png',
  width: 0,
  height: 0
}

function revoke(url) {
  if (url) URL.revokeObjectURL(url)
}

/* ---------- Upload view wiring ---------- */
const dropzone = $('dropzone')
const fileInput = $('fileInput')

dropzone.addEventListener('click', () => fileInput.click())
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    fileInput.click()
  }
})

fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0]
  if (file) handleFile(file)
  fileInput.value = ''
})

/* Drag & drop */
let dragDepth = 0
window.addEventListener('dragenter', (e) => {
  e.preventDefault()
  dragDepth++
  dropzone.classList.add('is-drag')
})
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dropzone.classList.remove('is-drag')
})
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => {
  e.preventDefault()
  dragDepth = 0
  dropzone.classList.remove('is-drag')
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
  if (file) handleFile(file)
})

/* Paste (screenshot / copied image) */
window.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items
  if (!items) return
  for (const item of items) {
    if (item.type && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) {
        handleFile(file)
        return
      }
    }
  }
  // No image in the clipboard — maybe they copied an image URL as text.
  const text = (e.clipboardData.getData('text/plain') || '').trim()
  if (/^(https?:\/\/|www\.)\S+$/i.test(text)) loadFromUrl(text)
})

/* Camera capture on mobile */
$('cameraBtn').addEventListener('click', () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.capture = 'environment'
  input.addEventListener('change', () => {
    const file = input.files && input.files[0]
    if (file) handleFile(file)
  })
  input.click()
})

/* URL loading (CORS required; falls back with a friendly error) */
$('urlGoBtn').addEventListener('click', () => loadFromUrl())
$('urlInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadFromUrl()
})

/* Public image proxy used as a last resort when a site blocks cross-origin
 * reads. Only the image URL is sent to it — never the image itself. */
const PROXY_PREFIX = 'https://wsrv.nl/?url='

async function loadFromUrl(raw) {
  raw = (raw || $('urlInput').value).trim()
  $('urlInput').value = ''
  if (!raw) return
  let url = raw
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url

  // Strategy chain: most images work via 1; blocked sites fall through to 3.
  const attempts = [
    () => fetchBlob(url),
    () => fetchViaImage(url),
    () => fetchBlob(PROXY_PREFIX + encodeURIComponent(url))
  ]

  for (const attempt of attempts) {
    try {
      const blob = await attempt()
      if (blob && blob.type && blob.type.startsWith('image/')) {
        handleFile(blob)
        return
      }
    } catch {
      /* try the next strategy */
    }
  }
  toast(
    "Couldn't load that link. Make sure it points to a direct image file (ending in .jpg/.png/…). If the site blocks hotlinking, save the image and upload it instead.",
    5000
  )
}

async function fetchBlob(url) {
  const res = await fetch(url, { mode: 'cors' })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.blob()
}

/* Some servers permit <img crossorigin=anonymous> loads even when plain fetch
 * is blocked. Drawing the image into a canvas re-encodes it as a PNG we own. */
function fetchViaImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = $('workCanvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        canvas.getContext('2d').drawImage(img, 0, 0)
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('tainted canvas'))),
          'image/png'
        )
      } catch (err) {
        reject(err)
      }
    }
    img.onerror = () => reject(new Error('image load failed'))
    img.src = url
  })
}
/* Sample images (CORS-friendly source) */
const SAMPLES = [
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=640&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1543466835-00a7907e9de1?w=640&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1561948955-570b270e7c36?w=640&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=640&q=80&auto=format&fit=crop'
]

function buildSamples() {
  const grid = $('sampleGrid')
  for (const src of SAMPLES) {
    const btn = document.createElement('button')
    btn.className = 'sample'
    btn.type = 'button'
    btn.setAttribute('aria-label', 'Try sample image')
    const img = document.createElement('img')
    img.src = src
    img.alt = ''
    img.loading = 'lazy'
    img.crossOrigin = 'anonymous'
    btn.appendChild(img)
    btn.addEventListener('click', () => {
      fetch(src, { mode: 'cors' })
        .then((r) => r.blob())
        .then(handleFile)
        .catch(() => toast("Couldn't load the sample. Check your connection."))
    })
    grid.appendChild(btn)
  }
}
buildSamples()

/* ---------- File intake ---------- */
const MAX_MB = 22

function handleFile(file) {
  if (!file.type || !/^image\/(png|jpeg|jpg|webp)$/i.test(file.type)) {
    toast('Only PNG, JPG and WebP images are supported.')
    return
  }
  if (file.size > MAX_MB * 1024 * 1024) {
    toast(`The maximum file size is ${MAX_MB} MB.`)
    return
  }
  state.originalBlob = file
  runRemoval(file)
}

/* ---------- Progress UI ---------- */
const STAGES = {
  fetch: 'Downloading the AI model (one time only)',
  compute: 'Cutting out the background…',
  final: 'Finishing up…'
}

function setProgress(label, pct) {
  const clamped = Math.max(0, Math.min(1, pct))
  $('progressSub').textContent = label
  $('progressFill').style.width = Math.round(clamped * 100) + '%'
  $('progressPct').textContent = Math.round(clamped * 100) + '%'
}

function fmtMB(bytes) {
  return (bytes / 1048576).toFixed(1)
}

/* ---------- Run lifecycle (cancel support) ----------
 * The library has no built-in cancellation: removeBackground() cannot be
 * stopped mid-inference, and its compute stages block the main thread in
 * chunks. We approximate a real cancel with three mechanisms:
 *   1. runId — a per-run token. Once cancelled, every callback and the final
 *      result of that run are ignored, so the UI is immediately free again.
 *   2. fetchArgs — passed straight through to fetch() for the model
 *      download, so the controller's signal HARD-ABORTS the ~95 MB download
 *      instantly (no waiting, no wasted bandwidth).
 *   3. abortEpoch — the library memoizes its init promise by
 *      JSON.stringify(config), so a rejected (aborted) download would poison
 *      every later run. Bumping __epoch inside fetchArgs gives the next run
 *      a fresh memo key and a clean re-init. Only bumped after a hard abort,
 *      so normal warm runs keep reusing the cached session. */
let runId = 0
let abortCtrl = null
let abortEpoch = 0
let computeStarted = false

function startRun() {
  runId++
  abortCtrl = new AbortController()
  computeStarted = false
  return runId
}

function isStale(id) {
  return id !== runId
}

function cancelRun() {
  runId++ // invalidate the in-flight run
  // Hard-abort only while the model download is in flight — once inference
  // has started there is nothing abortable, and skipping the abort keeps the
  // library's memoized session healthy for the next (fast) run.
  if (abortCtrl && !computeStarted) {
    abortCtrl.abort()
    abortEpoch++ // next run gets a fresh memo key (see comment above)
  }
  abortCtrl = null
  show('upload')
  toast('Cancelled.')
}

$('cancelBtn').addEventListener('click', cancelRun)

/* ---------- The main pipeline ---------- */
async function runRemoval(blob) {
  const id = startRun()
  show('progress')
  const thumbURL = URL.createObjectURL(blob)
  $('progressThumb').src = thumbURL
  setProgress(STAGES.fetch, 0.02)

  /* The library reports progress as (key, current, total) with namespaced
   * keys: "fetch:<resource>" (bytes, several resources in parallel) and
   * "compute:decode|inference|mask|encode" (steps). We aggregate each
   * namespace into a real percentage instead of keying on exact names. */
  const saw = { fetch: {}, compute: {} }
  const attempt = (device) =>
    removeBackground(blob, {
      model: 'isnet_fp16',
      // GPU (WebGPU) + worker proxying keeps inference OFF the main thread —
      // without this, compute blocks the whole UI and Cancel can't respond.
      // Browsers without WebGPU silently fall back to CPU/wasm (soft cancel).
      device,
      proxyToWorker: device === 'gpu',
      output: { format: 'image/png', quality: 1 },
      fetchArgs: { signal: abortCtrl.signal, __epoch: abortEpoch },
      progress: (key, current, total) => {
        if (isStale(id)) return
        const sep = key.indexOf(':')
        const kind = sep === -1 ? key : key.slice(0, sep)
        const sub = sep === -1 ? '' : key.slice(sep + 1)
        if (kind === 'fetch') saw.fetch[sub] = { current, total }
        else if (kind === 'compute') {
          computeStarted = true
          saw.compute[sub] = { current, total }
        } else return

        // Fetch: sum bytes across all (parallel) resources.
        let bytesDone = 0
        let bytesTotal = 0
        for (const r of Object.values(saw.fetch)) {
          if (r.total > 0) {
            bytesDone += Math.min(r.current, r.total)
            bytesTotal += r.total
          }
        }
        const fetchPct = bytesTotal > 0 ? bytesDone / bytesTotal : 0

        // Compute: average completion across the stages seen so far.
        const stages = Object.values(saw.compute).filter((s) => s.total > 0)
        const computePct =
          stages.length > 0
            ? stages.reduce((acc, s) => acc + Math.min(s.current / s.total, 1), 0) / stages.length
            : 0

        // Fetch is the big cost (~40+ MB): give it most of the bar.
        const pct = 0.04 + fetchPct * 0.86 + computePct * 0.1

        const label =
          stages.length > 0
            ? STAGES.compute
            : bytesTotal > 0
              ? `${STAGES.fetch} — ${fmtMB(bytesDone)} / ${fmtMB(bytesTotal)} MB`
              : STAGES.fetch
        setProgress(label, Math.min(pct, 0.99))
      }
    })

  /* If a WebGPU adapter exists but GPU inference itself fails (driver
   * quirks, blocked shaders), retry once on CPU so the app self-heals. */
  let cutout
  try {
    cutout = await attempt('gpu')
  } catch (err) {
    if (isStale(id)) throw err // user cancelled — outer catch swallows it
    console.warn('GPU/WebGPU inference failed — retrying on CPU.', err)
    for (const k of Object.keys(saw.fetch)) delete saw.fetch[k]
    for (const k of Object.keys(saw.compute)) delete saw.compute[k]
    cutout = await attempt('cpu')
  }

  try {
    if (isStale(id)) return
    setProgress(STAGES.final, 1)
    await displayResult(blob, cutout, id)
  } catch (err) {
    console.error(err)
    if (isStale(id)) return
    const msg = String((err && err.message) || err)
    showError(
      'Something went wrong',
      /fetch|network|load|resource/i.test(msg)
        ? 'The AI model failed to download. Check your internet connection and try again (it is a one-time ~95 MB download).'
        : 'The image could not be processed. Try a different photo — clear photos of people, products or animals work best.'
    )
  } finally {
    // Free this run's own thumbnail URL. Only reset the shared <img> if this
    // run still owns the UI — a newer run may already be using the element.
    revoke(thumbURL)
    if (!isStale(id)) $('progressThumb').removeAttribute('src')
  }
}

/* ---------- Result rendering ---------- */
async function displayResult(originalBlob, cutoutBlob, id) {
  const dims = await new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = reject
    img.src = URL.createObjectURL(cutoutBlob)
  }).catch(() => ({ w: 0, h: 0 }))

  /* A click queued during a main-thread inference block can dispatch here,
   * inside this await — after runRemoval's staleness check already passed.
   * Without this guard the cancelled run would still flip to the result view
   * and override the cancel. */
  if (isStale(id)) return

  state.cutoutBlob = cutoutBlob
  state.width = dims.w
  state.height = dims.h

  revoke(state.originalURL)
  revoke(state.cutoutURL)
  state.originalURL = URL.createObjectURL(originalBlob)
  state.cutoutURL = URL.createObjectURL(cutoutBlob)

  $('imgBefore').src = state.originalURL
  $('imgAfter').src = state.cutoutURL

  const name = (originalBlob && originalBlob.name) || 'image'
  state.downloadName = name.replace(/\.[^.]+$/, '') + '-no-bg.png'

  setSlider(50)
  setMode('split')
  applyBackground('transparent')

  const px = dims.w * dims.h
  const note = []
  note.push(`${dims.w} × ${dims.h} px`)
  if (px > 12_000_000) {
    note.push('Tip: huge image — downloading may take a moment.')
  }
  $('resultNote').textContent = note.join(' · ')

  show('result')
}

/* Before/after slider */
const slider = $('slider')

function setSlider(pct) {
  pct = Math.max(0, Math.min(100, pct))
  slider.style.setProperty('--pos', pct + '%')
  $('beforeClip').style.width = pct + '%'
  $('sliderHandle').style.left = pct + '%'
}

function pointerPct(e) {
  const rect = slider.getBoundingClientRect()
  const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left
  return (x / rect.width) * 100
}

slider.addEventListener('pointerdown', (e) => {
  if (state.mode !== 'split') return
  slider.setPointerCapture(e.pointerId)
  setSlider(pointerPct(e))
})
slider.addEventListener('pointermove', (e) => {
  if (state.mode !== 'split') return
  if (e.buttons > 0 || (e.pointerType === 'touch' && e.pressure > 0)) {
    setSlider(pointerPct(e))
  }
})

/* Compare mode */
function setMode(mode) {
  state.mode = mode
  slider.classList.toggle('slider--after', mode === 'after')
  slider.classList.toggle('slider--before', mode === 'before')
  // The split position is an inline style, so it must be managed explicitly:
  // 'before' mode needs the clip at 100% or the checkerboard shows through.
  if (mode === 'before') {
    $('beforeClip').style.width = '100%'
    $('sliderHandle').style.left = '100%'
  } else {
    $('beforeClip').style.width = '50%'
    $('sliderHandle').style.left = '50%'
  }
  for (const btn of $('compareSeg').querySelectorAll('.seg__btn')) {
    btn.classList.toggle('is-active', btn.dataset.mode === mode)
  }
}

$('compareSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg__btn')
  if (btn) setMode(btn.dataset.mode)
})

/* Background colors */
function applyBackground(color) {
  state.bgColor = color
  const checker = $('checker')
  if (color === 'transparent') {
    checker.style.background = ''
    checker.style.backgroundColor = ''
  } else {
    checker.style.background = color
  }
  for (const sw of $('swatches').querySelectorAll('.swatch')) {
    sw.classList.toggle('is-active', sw.dataset.color === color)
  }
}

$('swatches').addEventListener('click', (e) => {
  const sw = e.target.closest('.swatch')
  if (!sw) return
  if (sw.dataset.color === 'custom') {
    $('customColor').click()
    return
  }
  applyBackground(sw.dataset.color)
})

$('customColor').addEventListener('input', (e) => {
  applyBackground(e.target.value)
})

/* ---------- Download / share / reset ---------- */
async function composeFinalBlob() {
  if (state.bgColor === 'transparent') return state.cutoutBlob

  const canvas = $('workCanvas')
  canvas.width = state.width
  canvas.height = state.height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = state.bgColor
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const img = await new Promise((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = reject
    i.src = state.cutoutURL
  })
  ctx.drawImage(img, 0, 0)
  return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

$('downloadBtn').addEventListener('click', async () => {
  const btn = $('downloadBtn')
  try {
    btn.disabled = true
    const blob = await composeFinalBlob()
    revoke(state.downloadURL)
    state.downloadURL = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = state.downloadURL
    a.download = state.downloadName
    document.body.appendChild(a)
    a.click()
    a.remove()
  } catch (err) {
    console.error(err)
    toast('Download failed. Please try again.')
  } finally {
    btn.disabled = false
  }
})

$('shareBtn').addEventListener('click', async () => {
  if (!state.cutoutBlob) return
  const file = new File([state.cutoutBlob], state.downloadName, { type: 'image/png' })
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Image with background removed' })
    } catch (err) {
      if (err && err.name !== 'AbortError') toast('Sharing was cancelled.')
    }
  } else {
    await $('downloadBtn').click()
    toast('Saving instead — your browser does not support direct sharing.')
  }
})

$('newImageBtn').addEventListener('click', () => {
  revoke(state.downloadURL)
  state.downloadURL = null
  show('upload')
  setTimeout(() => fileInput.click(), 250)
})

$('errorBackBtn').addEventListener('click', () => show('upload'))

/* Auto-process from a link: index.html?image=<encoded image url> */
const autoImage = new URLSearchParams(location.search).get('image')
if (autoImage) loadFromUrl(autoImage)

/* Minimal hook for automation/testing (also used by ?image= flows) */
window.__cutout = { handleFile, runRemoval, loadFromUrl }

/* ---------- PWA ---------- */
// Register the service worker only in production builds — on the dev server
// it would cache raw assets and serve stale code across edits.
if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}
