// One-off script: generates the PWA icons (192 and 512 px PNGs) from an
// inline SVG rasterized via a tiny hand-rolled PNG encoder (zlib only).
// Run with:  node scripts/gen-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'public/icons')
mkdirSync(outDir, { recursive: true })

// ---------- Minimal PNG encoder ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

// ---------- Draw the icon ----------
// Rounded gradient square, white "C" ring with a gap (cutout motif).
function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4)
  const r = size * 0.22 // corner radius
  const cx = size / 2
  const cy = size / 2
  const ringR = size * 0.28 // ring radius
  const ringW = size * 0.11 // ring thickness
  const gapStart = -0.62 // gap angle start (radians, from +x axis)
  const gapEnd = 0.62

  const inRoundedSquare = (x, y) => {
    const dx = Math.max(r - x, x - (size - 1 - r), 0)
    const dy = Math.max(r - y, y - (size - 1 - r), 0)
    return dx * dx + dy * dy <= r * r
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      if (!inRoundedSquare(x, y)) continue

      // diagonal gradient #4f7cff -> #7c3aed
      const t = (x / size + y / size) / 2
      const R = Math.round(0x4f + (0x7c - 0x4f) * t)
      const G = Math.round(0x7c + (0x3a - 0x7c) * t)
      const B = 0xff

      const dx = x - cx
      const dy = y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      let white = false

      if (Math.abs(dist - ringR) <= ringW / 2) {
        let ang = Math.atan2(dy, dx) // -PI..PI
        if (ang < gapStart || ang > gapEnd) white = true
      }

      if (white) {
        px[i] = 255
        px[i + 1] = 255
        px[i + 2] = 255
        px[i + 3] = 255
      } else {
        px[i] = R
        px[i + 1] = G
        px[i + 2] = B
        px[i + 3] = 255
      }
    }
  }
  return encodePNG(size, size, px)
}

writeFileSync(resolve(outDir, 'icon-192.png'), drawIcon(192))
writeFileSync(resolve(outDir, 'icon-512.png'), drawIcon(512))
console.log('Wrote icons/icon-192.png and icons/icon-512.png')
