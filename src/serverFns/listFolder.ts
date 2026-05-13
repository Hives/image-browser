import { createServerFn } from '@tanstack/react-start'
import fs from 'node:fs/promises'
import path from 'node:path'

const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp',
  '.avif', '.bmp', '.svg', '.tiff', '.tif',
])

const sortedPaths = (paths: string[]) =>
  paths.sort((a, b) =>
    path.basename(a).localeCompare(path.basename(b), undefined, {
      numeric: true,
      sensitivity: 'base',
    }),
  )

export interface FolderEntry {
  name: string
  path: string
  isDirectory: boolean
}

export interface FolderContents {
  folder: string
  images: string[]
  subfolders: string[]
  siblings: string[]
  parent: string | null
  entries: FolderEntry[]
}

export const listFolder = createServerFn({ method: 'GET' })
  .inputValidator((data: { folder: string }) => data)
  .handler(async ({ data: { folder } }): Promise<FolderContents> => {
    const resolved = path.resolve(folder)
    const dirList = await fs.readdir(resolved, { withFileTypes: true })

    const images = sortedPaths(
      dirList
        .filter(e => e.isFile() && IMAGE_EXTS.has(path.extname(e.name).toLowerCase()))
        .map(e => path.join(resolved, e.name)),
    )

    const subfolders = sortedPaths(
      dirList
        .filter(e => e.isDirectory())
        .map(e => path.join(resolved, e.name)),
    )

    const parent = path.dirname(resolved)
    const isRoot = parent === resolved

    let siblings: string[] = []
    if (!isRoot) {
      const parentEntries = await fs.readdir(parent, { withFileTypes: true })
      siblings = sortedPaths(
        parentEntries
          .filter(e => e.isDirectory())
          .map(e => path.join(parent, e.name)),
      )
    }

    const dirEntries: FolderEntry[] = sortedPaths(
      dirList.filter(e => e.isDirectory()).map(e => path.join(resolved, e.name)),
    ).map(p => ({ name: path.basename(p), path: p, isDirectory: true }))

    const fileEntries: FolderEntry[] = sortedPaths(
      dirList.filter(e => e.isFile()).map(e => path.join(resolved, e.name)),
    ).map(p => ({ name: path.basename(p), path: p, isDirectory: false }))

    return {
      folder: resolved,
      images,
      subfolders,
      siblings,
      parent: isRoot ? null : parent,
      entries: [...dirEntries, ...fileEntries],
    }
  })
