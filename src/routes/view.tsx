import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useState, useEffect, useRef, useCallback } from 'react'
import { listFolder, type FolderContents, type FolderEntry } from '#/serverFns/listFolder'
import { listImages } from '#/serverFns/listImages'
import { deleteImage } from '#/serverFns/deleteImage'

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

function ViewerPage() {
  const data = Route.useLoaderData()
  const { root } = Route.useSearch()
  const navigate = useNavigate()
  const router = useRouter()

  const [selectedImageIndex, setSelectedImageIndex] = useState(0)
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [folderCursor, setFolderCursor] = useState(0)
  const [isFill, setIsFill] = useState(true)
  const [previewImages, setPreviewImages] = useState<string[] | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const thumbnailRefs = useRef<(HTMLButtonElement | null)[]>([])
  const panelItemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const folderCursorHistory = useRef<Map<string, number>>(new Map())

  const goToFolder = useCallback(
    (folder: string, imagePath?: string) => {
      folderCursorHistory.current.set(data.folder, folderCursor)
      if (imagePath) pendingImagePath = imagePath
      navigate({ to: '/view', search: { folder, root } })
    },
    [navigate, root, data.folder, folderCursor],
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
    setFolderCursor(folderCursorHistory.current.get(data.folder) ?? 0)
  }, [data.folder])

  // Auto-scroll selected thumbnail
  useEffect(() => {
    thumbnailRefs.current[selectedImageIndex]?.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    })
  }, [selectedImageIndex])

  // Auto-scroll folder cursor item
  useEffect(() => {
    panelItemRefs.current[folderCursor]?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    })
  }, [folderCursor])

  // When panel cursor lands on an image file, sync the image viewer
  useEffect(() => {
    if (!isPanelOpen) return
    const entry = data.entries[folderCursor]
    if (!entry || entry.isDirectory) return
    const imgIdx = data.images.indexOf(entry.path)
    if (imgIdx !== -1) setSelectedImageIndex(imgIdx)
  }, [folderCursor, isPanelOpen, data.entries, data.images])

  // When panel cursor lands on a directory, fetch preview images (debounced)
  useEffect(() => {
    if (!isPanelOpen) { setPreviewImages(null); return }
    const entry = data.entries[folderCursor]
    if (!entry?.isDirectory) { setPreviewImages(null); return }
    let cancelled = false
    const timer = setTimeout(() => {
      setPreviewLoading(true)
      listImages({ data: { folder: entry.path } }).then(imgs => {
        if (!cancelled) { setPreviewImages(imgs); setPreviewLoading(false) }
      })
    }, 150)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [folderCursor, isPanelOpen, data.entries])

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

  const goToParent = useCallback(() => {
    if (data.parent && data.folder !== root) goToFolder(data.parent)
  }, [data.parent, data.folder, root, goToFolder])

  const handleDelete = useCallback(async () => {
    const img = data.images[selectedImageIndex]
    if (!img) return
    const nextIndex = Math.min(selectedImageIndex, data.images.length - 2)
    await deleteImage({ data: { path: img } })
    setConfirmDelete(false)
    await router.invalidate()
    setSelectedImageIndex(Math.max(nextIndex, 0))
  }, [data.images, selectedImageIndex, router])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      if (confirmDelete) {
        if (e.key === 'Enter') { e.preventDefault(); handleDelete() }
        if (e.key === 'Escape') { e.preventDefault(); setConfirmDelete(false) }
        return
      }

      if (isPanelOpen) {
        switch (e.key) {
          case 'j':
            e.preventDefault()
            setFolderCursor(i => (i + 1) % data.entries.length)
            break
          case 'k':
            e.preventDefault()
            setFolderCursor(i => (i - 1 + data.entries.length) % data.entries.length)
            break
          case 'l':
            e.preventDefault()
            if (data.entries[folderCursor]?.isDirectory)
              goToFolder(data.entries[folderCursor].path)
            break
          case 'Enter':
            e.preventDefault()
            if (data.entries[folderCursor]?.isDirectory) {
              goToFolder(data.entries[folderCursor].path)
              setIsPanelOpen(false)
            }
            break
          case 'h':
            e.preventDefault()
            goToParent()
            break
          case 'Escape':
          case ' ':
            e.preventDefault()
            setIsPanelOpen(false)
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
            setIsPanelOpen(true)
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
              setIsPanelOpen(true)
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
    isPanelOpen,
    data.images.length,
    data.entries,
    folderCursor,
    confirmDelete,
    handleDelete,
    goToFolder,
    goToNextSibling,
    goToPrevSibling,
    goToParent,
  ])

  const selectedImage = data.images[selectedImageIndex]
  const selectedFilename = selectedImage?.split('/').pop() ?? ''

  const rootFolderName = root.split('/').pop() || root

  // Path relative to root for top bar display
  const relativePath = data.folder !== root && data.folder.startsWith(root)
    ? data.folder.slice(root.length).replace(/^\//, '')
    : ''
  const displayPath = [rootFolderName, ...(relativePath ? relativePath.split('/') : []), selectedFilename]
    .filter(Boolean)
    .join(' / ')

  return (
    <div className="flex h-screen overflow-hidden bg-black">
      {/* Main image area */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-neutral-950">
        {/* Top bar */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-4 py-3">
          <Link
            to="/"
            className="pointer-events-auto rounded px-2 py-1 text-xs text-white/60 no-underline transition-colors hover:text-white"
          >
            ← {rootFolderName}
          </Link>
          <span className="truncate rounded-md bg-black/40 px-3 py-1 text-xs text-white/90 backdrop-blur-sm">{displayPath}</span>
          <span className="whitespace-nowrap text-xs text-white/40">
            {data.images.length > 0
              ? `${selectedImageIndex + 1} / ${data.images.length}`
              : 'No images'}
          </span>
        </div>

        {/* Image, folder preview, or empty hint */}
        {isPanelOpen && (previewLoading || previewImages !== null) ? (
          previewLoading ? (
            <div className="text-neutral-500">
              <svg className="h-6 w-6 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            </div>
          ) : previewImages!.length === 0 ? (
            <div className="text-center text-neutral-500">
              <p className="text-lg">No images in this folder</p>
            </div>
          ) : (
            <div className="h-full w-full overflow-y-auto p-3">
              <div className="grid grid-cols-9 gap-1">
                {previewImages!.map(img => (
                  <button
                    key={img}
                    onClick={() => goToFolder(data.entries[folderCursor].path, img)}
                    className="overflow-hidden rounded focus:outline-none"
                  >
                    <img
                      src={`/api/image?path=${encodeURIComponent(img)}`}
                      alt={img.split('/').pop()}
                      className="aspect-square w-full object-cover transition-opacity hover:opacity-80"
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            </div>
          )
        ) : data.images.length > 0 && selectedImage ? (
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

        {/* Folder panel overlay */}
        <div
          className={`absolute inset-y-0 left-0 z-20 w-72 transform overflow-hidden bg-neutral-900 shadow-[4px_0_32px_rgba(0,0,0,0.6)] transition-transform duration-300 ease-in-out ${
            isPanelOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <FolderPanel
            data={data}
            root={root}
            folderCursor={folderCursor}
            itemRefs={panelItemRefs}
            onNavigate={goToFolder}
            onGoUp={goToParent}
            onClose={() => setIsPanelOpen(false)}
          />
        </div>

        {/* Delete confirmation modal */}
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

      {/* Thumbnail sidebar */}
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
                ref={el => {
                  thumbnailRefs.current[i] = el
                }}
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
    </div>
  )
}

interface FolderPanelProps {
  data: FolderContents
  root: string
  folderCursor: number
  itemRefs: React.RefObject<(HTMLButtonElement | null)[]>
  onNavigate: (path: string) => void
  onGoUp: () => void
  onClose: () => void
}

function FolderPanel({
  data,
  root,
  folderCursor,
  itemRefs,
  onNavigate,
  onGoUp,
  onClose,
}: FolderPanelProps) {
  const atRoot = data.folder === root

  // Breadcrumb segments from root folder downward
  const rootParts = root.split('/').filter(Boolean)
  const folderParts = data.folder.split('/').filter(Boolean)
  const startIdx = rootParts.length - 1
  const breadcrumbs = folderParts.slice(startIdx).map((name, i) => ({
    name,
    path: '/' + folderParts.slice(0, startIdx + i + 1).join('/'),
    isCurrent: startIdx + i === folderParts.length - 1,
  }))

  return (
    <div className="flex h-full flex-col text-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-3">
        <button
          onClick={onGoUp}
          disabled={atRoot}
          className={`text-xs transition-colors ${
            atRoot
              ? 'cursor-not-allowed text-neutral-700'
              : 'text-neutral-400 hover:text-white'
          }`}
          aria-label="Go up one level"
        >
          ← up
        </button>
        <button
          onClick={onClose}
          className="text-neutral-500 transition-colors hover:text-white"
          aria-label="Close folder panel"
        >
          ✕
        </button>
      </div>

      {/* Breadcrumb */}
      <div className="border-b border-neutral-800 px-3 py-2">
        <div className="flex flex-wrap items-center gap-0.5 text-xs">
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.path} className="flex items-center gap-0.5">
              {i > 0 && <span className="text-neutral-700">/</span>}
              {crumb.isCurrent ? (
                <span className="text-white">{crumb.name}</span>
              ) : (
                <button
                  onClick={() => onNavigate(crumb.path)}
                  className="text-neutral-400 transition-colors hover:text-white"
                >
                  {crumb.name}
                </button>
              )}
            </span>
          ))}
        </div>
      </div>

      {/* Entries list */}
      <div className="flex-1 overflow-y-auto">
        {data.entries.length === 0 ? (
          <div className="px-3 py-4 text-xs text-neutral-600">Empty folder</div>
        ) : (
          data.entries.map((entry: FolderEntry, i: number) => {
            const isCursor = i === folderCursor
            return (
              <button
                key={entry.path}
                ref={el => {
                  itemRefs.current[i] = el
                }}
                onClick={() => entry.isDirectory ? onNavigate(entry.path) : undefined}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                  isCursor
                    ? 'bg-neutral-700 text-white'
                    : entry.isDirectory
                      ? 'text-neutral-300 hover:bg-neutral-800 hover:text-white'
                      : 'cursor-default text-neutral-600'
                }`}
              >
                <span className="w-3 flex-shrink-0 text-center text-xs text-blue-400">
                  {entry.isDirectory ? '›' : ''}
                </span>
                <span className="truncate">{entry.name}</span>
              </button>
            )
          })
        )}
      </div>

      {/* Key hints */}
      <div className="border-t border-neutral-800 px-3 py-2">
        <div className="flex flex-wrap gap-2 text-[10px] text-neutral-600">
          {[
            ['j/k', 'move'],
            ['l / ↵', 'enter dir'],
            ['h', 'up'],
            ['Space', 'close'],
            ['n/p', 'sibling'],
          ].map(([key, label]) => (
            <span key={key}>
              <kbd className="rounded bg-neutral-800 px-1 text-neutral-400">{key}</kbd> {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

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
