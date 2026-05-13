import { createServerFn } from '@tanstack/react-start'
import fs from 'node:fs/promises'

export const deleteImage = createServerFn({ method: 'POST' })
  .inputValidator((data: { path: string }) => data)
  .handler(async ({ data: { path } }) => {
    await fs.unlink(path)
  })
