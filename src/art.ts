// Album art for the glasses: download, square-crop, greyscale, boost contrast,
// Floyd–Steinberg dither to 16 levels, and hand the SDK a PNG.

const cache = new Map<string, Uint8Array | null>()
const inflight = new Map<string, Promise<Uint8Array | null>>()

export async function artPng(url: string, size: number): Promise<Uint8Array | null> {
  const key = `${url}@${size}`
  if (cache.has(key)) return cache.get(key)!
  let p = inflight.get(key)
  if (!p) {
    p = render(url, size)
      .catch(e => {
        console.warn('[hq] album art failed', e)
        return null
      })
      .then(bytes => {
        cache.set(key, bytes)
        inflight.delete(key)
        return bytes
      })
    inflight.set(key, p)
  }
  return p
}

async function render(url: string, size: number): Promise<Uint8Array | null> {
  const res = await fetch(url)
  if (!res.ok) return null
  const bmp = await createImageBitmap(await res.blob())
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  const side = Math.min(bmp.width, bmp.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size)
  const img = ctx.getImageData(0, 0, size, size)
  ditherTo16(img.data, size, size)
  ctx.putImageData(img, 0, 0)
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null
}

/** In-place: RGBA -> greyscale quantised to 16 levels with error diffusion. */
export function ditherTo16(px: Uint8ClampedArray, w: number, h: number): void {
  const lum = new Float32Array(w * h)
  let min = 255
  let max = 0
  for (let i = 0; i < w * h; i++) {
    const v = 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]
    lum[i] = v
    if (v < min) min = v
    if (v > max) max = v
  }
  // Stretch contrast: the waveguide shows dark as see-through, so use the full range.
  const span = Math.max(1, max - min)
  for (let i = 0; i < lum.length; i++) lum[i] = ((lum[i] - min) / span) * 255
  const step = 255 / 15
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const old = lum[i]
      const q = Math.round(Math.max(0, Math.min(255, old)) / step) * step
      const err = old - q
      lum[i] = q
      if (x + 1 < w) lum[i + 1] += (err * 7) / 16
      if (y + 1 < h) {
        if (x > 0) lum[i + w - 1] += (err * 3) / 16
        lum[i + w] += (err * 5) / 16
        if (x + 1 < w) lum[i + w + 1] += err / 16
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    const v = Math.round(lum[i])
    px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v
    px[i * 4 + 3] = 255
  }
}

/** Testing aid: a generated placeholder cover (no network). */
export async function placeholderArt(size: number): Promise<Uint8Array | null> {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, size, size)
  g.addColorStop(0, '#fff')
  g.addColorStop(1, '#222')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = '#000'
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 3, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 10, 0, Math.PI * 2)
  ctx.fill()
  const img = ctx.getImageData(0, 0, size, size)
  ditherTo16(img.data, size, size)
  ctx.putImageData(img, 0, 0)
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null
}
