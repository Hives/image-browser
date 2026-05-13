import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'

export const Route = createFileRoute('/')({ component: HomePage })

function HomePage() {
  const navigate = useNavigate()
  const [folder, setFolder] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = folder.trim()
    if (!trimmed) return
    setError('')
    navigate({ to: '/view', search: { folder: trimmed, root: trimmed } })
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="island-shell w-full max-w-lg rounded-3xl px-10 py-12">
        <p className="island-kicker mb-3">Local Image Browser</p>
        <h1 className="display-title mb-3 text-3xl font-bold text-[var(--sea-ink)]">
          Open a folder
        </h1>
        <p className="mb-8 text-sm text-[var(--sea-ink-soft)]">
          Enter the path to a folder on your local file system to browse its
          images.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="/path/to/your/images"
            className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--sea-ink)] placeholder-[var(--sea-ink-soft)] outline-none focus:border-[var(--lagoon-deep)] focus:ring-2 focus:ring-[rgba(50,143,151,0.2)]"
            autoFocus
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={!folder.trim()}
            className="rounded-xl bg-[var(--lagoon-deep)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--lagoon)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Browse Images →
          </button>
        </form>
      </div>
    </main>
  )
}

