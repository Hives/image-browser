import { defineEventHandler, getQuery } from 'h3'
import fs from 'node:fs/promises'
import path from 'node:path'

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

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const imagePath = query.path as string | undefined
  if (!imagePath) {
    return new Response('Missing path parameter', { status: 400 })
  }
  try {
    const data = await fs.readFile(imagePath)
    const ext = path.extname(imagePath).toLowerCase()
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
