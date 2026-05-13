import { createServerFn } from '@tanstack/react-start'
import fs from 'node:fs/promises'
import path from 'node:path'

const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp',
  '.avif', '.bmp', '.svg', '.tiff', '.tif',
])

export const listImages = createServerFn({ method: 'GET' })
  .inputValidator((data: { folder: string }) => data)
  .handler(async ({ data: { folder } }) => {
    const entries = await fs.readdir(folder, { withFileTypes: true })
    return entries
      .filter(e => e.isFile() && IMAGE_EXTS.has(path.extname(e.name).toLowerCase()))
      .map(e => path.join(folder, e.name))
      .sort((a, b) =>
        path.basename(a).localeCompare(path.basename(b), undefined, {
          numeric: true,
          sensitivity: 'base',
        }),
      )
  })
