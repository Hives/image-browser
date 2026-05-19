import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { listFolder, type FolderContents } from '#/serverFns/listFolder'
import { listImages } from '#/serverFns/listImages'
import { deleteImage } from '#/serverFns/deleteImage'

const CELL_SIZE_KEY = 'image-browser:grid-cell-size'
const DEFAULT_CELL_SIZE = 160
const MIN_CELL_SIZE = 80
const MAX_CELL_SIZE = 320
const CELL_SIZE_STEP = 20

// Survives component unmount during pending navigation
let pendingImagePath: string | null = null

export const Route = createFileRoute('/view')({
  validateSearch: (search: Record<string, unknown>) => ({
    folder: String(search.folder ?? ''),
    root: String(search.root ?? search.folder ?? ''),
  }),
  loaderDeps: ({ search: { folder } }) => ({ folder }),
  loader: async ({ deps: { folder } }) => listFolder({ data: { folder } }),
  component: ViewerPage,
  errorComponent: ViewerError,
  pendingComponent: ViewerPending,
})

type Mode = 'image' | 'folder'

type GridItem = {
  type: 'parent' | 'folder' | 'image' | 'file'
  path: string
  name: string
}

function buildGridItems(data: FolderContents, root: string): GridItem[] {
  const items: GridItem[] = []
  const atRoot = data.folder === root || data.parent === null

  if (!atRoot && data.parent) {
    items.push({ type: 'parent', path: data.parent, name: '..' })
  }

  const imageSet = new Set(data.images)

  for (const entry of data.entries) {
    if (entry.isDirectory) {
      items.push({ type: 'folder', path: entry.path, name: entry.name })
    } else {
      items.push({
        type: imageSet.has(entry.path) ? 'image' : 'file',
        path: entry.path,
        name: entry.name,
      })
    }
  }

  return items
}

function ViewerPage() {
  const data = Route.useLoaderData()
  const { root } = Route.useSearch()
  const navigate = useNavigate()
  const router = useRouter()

  const [mode, setMode] = useState<Mode>('folder')
  const [selectedImageIndex, setSelectedImageIndex] = useState(0)
  const [gridCursor, setGridCursor] = useState(0)
  const [gridCellSize, setGridCellSize] = useState(() => {
    try {
      const stored = localStorage.getItem(CELL_SIZE_KEY)
      if (stored) {
        const n = parseInt(stored)
        if (!isNaN(n)) return Math.max(MIN_CELL_SIZE, Math.min(MAX_CELL_SIZE, n))
      }
    } catch {}
    return DEFAULT_CELL_SIZE
  })
  const [isFill, setIsFill] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const thumbnailRefs = useRef<(HTMLButtonElement | null)[]>([])
  const gridItemRefs = useRef<(HTMLDivElement | null)[]>([])
  const colsRef = useRef(4)
  const folderCursorHistory = useRef<Map<string, number>>(new Map())

  const gridItems = useMemo(() => buildGridItems(data, root), [data, root])

  useEffect(() => {
    try { localStorage.setItem(CELL_SIZE_KEY, String(gridCellSize)) } catch {}
  }, [gridCellSize])

  const goToFolder = useCallback(
    (folder: string, imagePath?: string) => {
      folderCursorHistory.current.set(data.folder, gridCursor)
      if (imagePath) pendingImagePath = imagePath
      navigate({ to: '/view', search: { folder, root } })
    },
    [navigate, root, data.folder, gridCursor],
  )

  const handleGridItemClick = useCallback(
    (item: GridItem, index: number) => {
      if (item.type === 'parent' || item.type === 'folder') {
        goToFolder(item.path)
      } else if (item.type === 'image') {
        const idx = data.images.indexOf(item.path)
        if (idx !== -1) {
          setGridCursor(index)
          setSelectedImageIndex(idx)
          setMode('image')
        }
      }
    },
    [goToFolder, data.images],
  )

  // Reset per-folder state when folder changes, restoring saved cursor
  useEffect(() => {
    const pending = pendingImagePath
    pendingImagePath = null
    if (pending) {
      const idx = data.images.indexOf(pending)
      setSelectedImageIndex(idx !== -1 ? idx : 0)
    } else {
      setSelectedImageIndex(0)
    }
    const saved = folderCursorHistory.current.get(data.folder) ?? 0
    setGridCursor(Math.min(saved, Math.max(0, gridItems.length - 1)))
  }, [data.folder]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll selected thumbnail
  useEffect(() => {
    thumbnailRefs.current[selectedImageIndex]?.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    })
  }, [selectedImageIndex])

  // Auto-scroll grid cursor item
  useEffect(() => {
    gridItemRefs.current[gridCursor]?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    })
  }, [gridCursor])

  const goToNextSibling = useCallback(() => {
    if (!data.siblings.length || data.folder === root) return
    const idx = data.siblings.indexOf(data.folder)
    if (idx === -1) return
    goToFolder(data.siblings[(idx + 1) % data.siblings.length])
  }, [data.siblings, data.folder, root, goToFolder])

  const goToPrevSibling = useCallback(() => {
    if (!data.siblings.length || data.folder === root) return
    const idx = data.siblings.indexOf(data.folder)
    if (idx === -1) return
    goToFolder(data.siblings[(idx - 1 + data.siblings.length) % data.siblings.length])
  }, [data.siblings, data.folder, root, goToFolder])

  const handleDelete = useCallback(async () => {
    const img = data.images[selectedImageIndex]
    if (!img) return
    const nextIndex = Math.min(selectedImageIndex, data.images.length - 2)
    await deleteImage({ data: { path: img } })
    setConfirmDelete(false)
    await router.invalidate()
    setSelectedImageIndex(Math.max(nextIndex, 0))
  }, [data.images, selectedImageIndex, router])

  const syncGridCursorToImage = useCallback(() => {
    const img = data.images[selectedImageIndex]
    if (!img) return
    const idx = gridItems.findIndex(item => item.path === img)
    if (idx !== -1) setGridCursor(idx)
  }, [data.images, selectedImageIndex, gridItems])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return

      if (confirmDelete) {
        if (e.key === 'Enter') { e.preventDefault(); handleDelete() }
        if (e.key === 'Escape') { e.preventDefault(); setConfirmDelete(false) }
        return
      }

      if (mode === 'folder') {
        const n = gridItems.length
        const c = colsRef.current

        switch (e.key) {
          case 'h':
            e.preventDefault()
            if (n === 0) break
            setGridCursor(i => (i === 0 ? n - 1 : i - 1))
            break
          case 'l':
            e.preventDefault()
            if (n === 0) break
            setGridCursor(i => (i === n - 1 ? 0 : i + 1))
            break
          case 'j':
            e.preventDefault()
            if (n === 0) break
            setGridCursor(i => {
              const next = i + c
              if (next >= n) return Math.min(i % c, n - 1)
              return next
            })
            break
          case 'k':
            e.preventDefault()
            if (n === 0) break
            setGridCursor(i => {
              const prev = i - c
              if (prev < 0) {
                const lastRowStart = Math.floor((n - 1) / c) * c
                return Math.min(lastRowStart + (i % c), n - 1)
              }
              return prev
            })
            break
          case 'Enter': {
            e.preventDefault()
            const item = gridItems[gridCursor]
            if (!item) break
            if (item.type === 'parent' || item.type === 'folder') {
              goToFolder(item.path)
            } else if (item.type === 'image') {
              const idx = data.images.indexOf(item.path)
              if (idx !== -1) {
                setSelectedImageIndex(idx)
                setMode('image')
              }
            }
            break
          }
          case 'u':
            e.preventDefault()
            if (data.parent && data.folder !== root) goToFolder(data.parent)
            break
          case ' ': {
            e.preventDefault()
            const cursorItem = gridItems[gridCursor]
            if (cursorItem?.type === 'image') {
              const idx = data.images.indexOf(cursorItem.path)
              if (idx !== -1) setSelectedImageIndex(idx)
            }
            setMode('image')
            break
          }
          case '+':
          case '=':
            e.preventDefault()
            setGridCellSize(s => Math.min(MAX_CELL_SIZE, s + CELL_SIZE_STEP))
            break
          case '-':
            e.preventDefault()
            setGridCellSize(s => Math.max(MIN_CELL_SIZE, s - CELL_SIZE_STEP))
            break
        }
      } else {
        switch (e.key) {
          case 'j':
            e.preventDefault()
            if (data.images.length > 0)
              setSelectedImageIndex(i => (i + 1) % data.images.length)
            break
          case 'k':
            e.preventDefault()
            if (data.images.length > 0)
              setSelectedImageIndex(i => (i - 1 + data.images.length) % data.images.length)
            break
          case ' ':
            e.preventDefault()
            syncGridCursorToImage()
            setMode('folder')
            break
          case 'n':
            e.preventDefault()
            goToNextSibling()
            break
          case 'p':
            e.preventDefault()
            goToPrevSibling()
            break
          case 'f':
            e.preventDefault()
            setIsFill(v => !v)
            break
          case 'd':
            e.preventDefault()
            if (data.images.length > 0) setConfirmDelete(true)
            break
          case 'h':
            e.preventDefault()
            if (data.parent && data.folder !== root) {
              goToFolder(data.parent)
              setMode('folder')
            }
            break
          case 'PageDown':
            e.preventDefault()
            if (data.images.length > 0)
              setSelectedImageIndex(i => Math.min(i + 10, data.images.length - 1))
            break
          case 'PageUp':
            e.preventDefault()
            if (data.images.length > 0)
              setSelectedImageIndex(i => Math.max(i - 10, 0))
            break
        }
      }
    }

    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [
    mode,
    gridItems,
    gridCursor,
    data.images,
    data.parent,
    data.folder,
    root,
    confirmDelete,
    handleDelete,
    goToFolder,
    goToNextSibling,
    goToPrevSibling,
    syncGridCursorToImage,
  ])

  const selectedImage = data.images[selectedImageIndex]
  const selectedFilename = selectedImage?.split('/').pop() ?? ''
  const rootFolderName = root.split('/').pop() || root
  const relativePath =
    data.folder !== root && data.folder.startsWith(root)
      ? data.folder.slice(root.length).replace(/^\//, '')
      : ''
  const displayPath = [
    rootFolderName,
    ...(relativePath ? relativePath.split('/') : []),
    ...(mode === 'image' && selectedFilename ? [selectedFilename] : []),
  ]
    .filter(Boolean)
    .join(' / ')

  return (
    <div className="flex h-screen overflow-hidden bg-black">
      {/* Main content area */}
      <div className="relative flex flex-1 flex-col overflow-hidden bg-neutral-950">
        {/* Top bar */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-4 py-3">
          <Link
            to="/"
            className="pointer-events-auto rounded px-2 py-1 text-xs text-white/60 no-underline transition-colors hover:text-white"
          >
            ← {rootFolderName}
          </Link>
          <span className="truncate rounded-md bg-black/40 px-3 py-1 text-xs text-white/90 backdrop-blur-sm">
            {displayPath}
          </span>
          {mode === 'image' ? (
            <span className="whitespace-nowrap text-xs text-white/40">
              {data.images.length > 0
                ? `${selectedImageIndex + 1} / ${data.images.length}`
                : 'No images'}
            </span>
          ) : (
            <span className="whitespace-nowrap text-xs text-white/40">
              {gridItems.length} {gridItems.length === 1 ? 'item' : 'items'}
            </span>
          )}
        </div>

        {mode === 'folder' ? (
          <FolderGrid
            gridItems={gridItems}
            gridCursor={gridCursor}
            gridCellSize={gridCellSize}
            itemRefs={gridItemRefs}
            colsRef={colsRef}
            onItemClick={handleGridItemClick}
          />
        ) : (
          <div className="flex flex-1 min-h-0 items-center justify-center">
            {data.images.length > 0 && selectedImage ? (
              <img
                key={selectedImage}
                src={`/api/image?path=${encodeURIComponent(selectedImage)}`}
                alt={selectedFilename}
                className={isFill ? 'h-full w-full object-contain' : 'max-h-full max-w-full object-contain'}
              />
            ) : (
              <div className="text-center text-neutral-500">
                <p className="mb-3 text-lg">No images in this folder</p>
                <p className="text-sm">
                  Press{' '}
                  <kbd className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-xs text-neutral-300">
                    Space
                  </kbd>{' '}
                  to browse folders
                </p>
              </div>
            )}

            {confirmDelete && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                <div className="rounded-xl bg-neutral-900 p-6 shadow-2xl ring-1 ring-neutral-700">
                  <p className="mb-1 text-sm font-medium text-white">Delete image?</p>
                  <p className="mb-5 max-w-xs truncate text-xs text-neutral-400">{selectedFilename}</p>
                  <div className="flex gap-3">
                    <button
                      onClick={handleDelete}
                      className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="rounded-lg bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-600"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Thumbnail sidebar — image mode only */}
      {mode === 'image' && (
        <div className="w-44 flex-shrink-0 overflow-y-auto border-l border-neutral-800 bg-neutral-900">
          {data.images.length === 0 ? (
            <div className="p-4 text-center text-xs text-neutral-600">No images</div>
          ) : (
            <>
              <div className="h-[50vh]" aria-hidden />
              {data.images.map((img, i) => {
                const filename = img.split('/').pop() ?? ''
                const isSelected = i === selectedImageIndex
                return (
                  <button
                    key={img}
                    ref={el => { thumbnailRefs.current[i] = el }}
                    onClick={() => setSelectedImageIndex(i)}
                    className={`block w-full cursor-pointer text-left transition-all ${
                      isSelected ? 'bg-neutral-600 px-1.5 py-1.5' : 'p-2 hover:bg-neutral-800'
                    }`}
                  >
                    <div
                      className={`overflow-hidden rounded ${isSelected ? 'ring-2 ring-white shadow-lg shadow-white/10' : ''}`}
                    >
                      <img
                        src={`/api/image?path=${encodeURIComponent(img)}`}
                        alt={filename}
                        className={`aspect-square w-full object-cover transition-opacity ${isSelected ? '' : 'opacity-40'}`}
                        loading="lazy"
                      />
                    </div>
                    <p
                      className={`mt-1 truncate text-center leading-tight ${
                        isSelected ? 'text-[11px] font-medium text-white' : 'text-[10px] text-neutral-400'
                      }`}
                    >
                      {filename}
                    </p>
                  </button>
                )
              })}
              <div className="h-[50vh]" aria-hidden />
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── FolderGrid ──────────────────────────────────────────────────────────────

interface FolderGridProps {
  gridItems: GridItem[]
  gridCursor: number
  gridCellSize: number
  itemRefs: React.RefObject<(HTMLDivElement | null)[]>
  colsRef: React.MutableRefObject<number>
  onItemClick: (item: GridItem, index: number) => void
}

function FolderGrid({ gridItems, gridCursor, gridCellSize, itemRefs, colsRef, onItemClick }: FolderGridProps) {
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const update = () => {
      const template = window.getComputedStyle(el).getPropertyValue('grid-template-columns')
      if (template && template !== 'none') {
        colsRef.current = template.trim().split(/\s+/).length
      }
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [colsRef])

  return (
    <div className="h-full w-full overflow-y-auto px-4 pb-16 pt-14">
      {gridItems.length === 0 ? (
        <div className="flex h-full items-center justify-center text-neutral-600">
          Empty folder
        </div>
      ) : (
        <div
          ref={gridRef}
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(auto-fill, ${gridCellSize}px)` }}
        >
          {gridItems.map((item, i) => (
            <div key={item.path + item.type} ref={el => { itemRefs.current[i] = el }}>
              <GridCell
                item={item}
                isSelected={i === gridCursor}
                cellSize={gridCellSize}
                onClick={() => onItemClick(item, i)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── GridCell ────────────────────────────────────────────────────────────────

interface GridCellProps {
  item: GridItem
  isSelected: boolean
  cellSize: number
  onClick: () => void
}

function GridCell({ item, isSelected, onClick }: GridCellProps) {
  const shell = `rounded-lg overflow-hidden transition-all cursor-pointer ${
    isSelected
      ? 'ring-2 ring-white bg-neutral-700/60'
      : 'ring-1 ring-neutral-800 bg-neutral-900 hover:ring-neutral-600'
  }`

  let visual: React.ReactNode
  if (item.type === 'parent') {
    visual = (
      <div className="flex aspect-square items-center justify-center">
        <FolderIcon tight className="h-2/3 w-2/3 text-amber-700/80" />
      </div>
    )
  } else if (item.type === 'folder') {
    visual = <SubfolderPreview path={item.path} />
  } else if (item.type === 'image') {
    visual = (
      <div className="aspect-square overflow-hidden">
        <img
          src={`/api/image?path=${encodeURIComponent(item.path)}`}
          alt={item.name}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </div>
    )
  } else {
    visual = (
      <div className="flex aspect-square items-center justify-center">
        <FileIcon className="h-1/3 w-1/3 text-neutral-600" />
      </div>
    )
  }

  return (
    <div className={shell} onClick={onClick}>
      {visual}
      <p
        className={`truncate px-1.5 py-1 text-center text-[11px] leading-tight ${
          isSelected ? 'text-white' : 'text-neutral-400'
        }`}
      >
        {item.name}
      </p>
    </div>
  )
}

// ── SubfolderPreview ────────────────────────────────────────────────────────

function SubfolderPreview({ path }: { path: string }) {
  const [previews, setPreviews] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setPreviews(null)
    listImages({ data: { folder: path } })
      .then(imgs => {
        if (!cancelled) { setPreviews(imgs.slice(0, 4)); setLoading(false) }
      })
      .catch(() => {
        if (!cancelled) { setPreviews([]); setLoading(false) }
      })
    return () => { cancelled = true }
  }, [path])

  if (loading) {
    return (
      <div className="relative aspect-square overflow-hidden">
        <FolderIcon tight className="absolute inset-0 h-full w-full text-amber-700/80" />
        <div className="absolute inset-0 flex items-end justify-center pb-[16%]">
          <Spinner />
        </div>
      </div>
    )
  }

  return (
    <div className="relative aspect-square overflow-hidden">
      <FolderIcon tight className="absolute inset-0 h-full w-full text-amber-700/80" />
      {/* Thumbnails inside the folder body (tight viewBox body: ~x4–96%, y28–83%) */}
      <div className="absolute inset-x-[11%] top-[31%] bottom-[19%] grid grid-cols-2 gap-0.5 overflow-hidden rounded-sm shadow-md">
        {[0, 1, 2, 3].map(idx =>
          previews && previews[idx] ? (
            <img
              key={previews[idx]}
              src={`/api/image?path=${encodeURIComponent(previews[idx])}`}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div key={idx} className="bg-neutral-800/80" />
          ),
        )}
      </div>
    </div>
  )
}

// ── Icons ───────────────────────────────────────────────────────────────────

function FolderIcon({ className, tight }: { className?: string; tight?: boolean }) {
  // tight viewBox crops built-in whitespace so the shape fills the element
  const viewBox = tight ? '1 3 22 18' : '0 0 24 24'
  return (
    <svg viewBox={viewBox} fill="currentColor" className={className} aria-hidden>
      <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
  )
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg className="h-6 w-6 animate-spin text-neutral-500" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
    </svg>
  )
}

// ── Error / Pending ─────────────────────────────────────────────────────────

function ViewerError({ error }: { error: Error }) {
  return (
    <div className="flex h-screen items-center justify-center bg-neutral-950 text-neutral-400">
      <div className="text-center">
        <p className="mb-2 text-lg text-red-400">Could not open folder</p>
        <p className="mb-6 text-sm">{error.message}</p>
        <Link
          to="/"
          className="rounded-lg bg-neutral-800 px-4 py-2 text-sm text-white no-underline hover:bg-neutral-700"
        >
          ← Try a different path
        </Link>
      </div>
    </div>
  )
}

function ViewerPending() {
  return (
    <div className="flex h-screen items-center justify-center bg-neutral-950 text-neutral-500">
      Loading…
    </div>
  )
}
