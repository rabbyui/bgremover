/* Cutout service worker
 * - Precaches the app shell so the installed PWA opens offline.
 * - The AI model itself (~95 MB) is cached by the browser's regular HTTP
 *   cache; large responses are intentionally NOT stored here.
 */
const VERSION = 'cutout-v2'
const APP_SHELL = [
  './',
  './index.html',
  './src/style.css',
  './src/main.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(APP_SHELL).catch(() => undefined))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Never touch the onnx runtime / model downloads here (too big to cache;
  // the browser HTTP cache handles them, with range-request support).
  if (url.hostname.includes('staticimgly.com') || url.hostname.includes('cdn.jsdelivr.net')) {
    return
  }

  // Only handle same-origin GETs.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return

  event.respondWith(
    (async () => {
      // Network-first for navigations so code changes show up immediately;
      // cached shell is only the offline fallback.
      if (event.request.mode === 'navigate') {
        try {
          return await fetch(event.request)
        } catch {
          const cached = await caches.match('./index.html')
          if (cached) return cached
          throw new Error('offline and no cached shell')
        }
      }

      // Cache-first for static assets (all content-hashed in production).
      const cached = await caches.match(event.request)
      if (cached) return cached
      const res = await fetch(event.request)
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone()
        caches.open(VERSION).then((cache) => cache.put(event.request, copy))
      }
      return res
    })()
  )
})
