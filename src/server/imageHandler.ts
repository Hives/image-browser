import { defineEventHandler, getQuery } from 'h3'
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
}

// Formats that sharp can resize (exclude SVG, GIF, TIFF for simplicity)
const RESIZABLE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.bmp'])

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const imagePath = query.path as string | undefined
  if (!imagePath) {
    return new Response('Missing path parameter', { status: 400 })
  }
  try {
    const ext = path.extname(imagePath).toLowerCase()
    const w = parseInt(query.w as string ?? '')

    if (!isNaN(w) && w > 0 && RESIZABLE_EXTS.has(ext)) {
      const thumb = await sharp(imagePath)
        .resize(w, w, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer()
      return new Response(thumb, {
        headers: {
          'Content-Type': 'image/webp',
          'Cache-Control': 'public, max-age=86400',
        },
      })
    }

    const data = await fs.readFile(imagePath)
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream'
    return new Response(data, {
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch {
    return new Response('Image not found', { status: 404 })
  }
})
