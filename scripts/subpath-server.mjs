// Serves dist/ under a subpath prefix — simulates GitHub Pages project sites
// (https://user.github.io/repo/). Usage: node scripts/subpath-server.mjs
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

const PREFIX = '/bgremover'
const ROOT = 'dist'
const PORT = 8788

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.svg': 'image/svg+xml'
}

createServer((req, res) => {
  let path = decodeURIComponent(req.url.split('?')[0])
  if (path.startsWith(PREFIX)) path = path.slice(PREFIX.length) || '/'
  // Pages behavior: bare directory → index.html, unknown → 404 page.
  if (path === '/' || path === '') path = '/index.html'
  const file = normalize(join(ROOT, path))
  if (!file.startsWith(ROOT) || !existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    return res.end('404: ' + path)
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' })
  res.end(readFileSync(file))
}).listen(PORT, () => {
  console.log(`Simulating https://rabbyui.github.io/bgremover/ at http://localhost:${PORT}${PREFIX}/`)
})
