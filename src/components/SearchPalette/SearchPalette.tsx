import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import {
  walkFiles,
  searchContent,
  rankByName,
  type VaultFile,
  type ContentMatch,
} from '../../lib/search'

type Mode = 'files' | 'content'

export function SearchPalette({
  initialMode,
  onClose,
}: {
  initialMode: Mode
  onClose: () => void
}) {
  const vaultPath = useAppStore((s) => s.vaultPath)
  const setSelectedFile = useAppStore((s) => s.setSelectedFile)
  const setPendingHighlight = useAppStore((s) => s.setPendingHighlight)

  const [mode, setMode] = useState<Mode>(initialMode)
  const [files, setFiles] = useState<VaultFile[]>([])
  const [query, setQuery] = useState('')
  const [fileResults, setFileResults] = useState<VaultFile[]>([])
  const [contentResults, setContentResults] = useState<ContentMatch[]>([])
  const [searching, setSearching] = useState(false)
  const [sel, setSel] = useState(0)

  // Indicizza i file del vault all'apertura.
  useEffect(() => {
    if (!vaultPath) return
    let cancelled = false
    walkFiles(vaultPath).then((fs) => {
      if (!cancelled) setFiles(fs)
    })
    return () => {
      cancelled = true
    }
  }, [vaultPath])

  // Filtro per nome (istantaneo).
  useEffect(() => {
    if (mode !== 'files') return
    const q = query.trim().toLowerCase()
    const res =
      q === ''
        ? files.slice(0, 50)
        : files
            .filter((f) => f.rel.toLowerCase().includes(q))
            .sort((a, b) => rankByName(a, q) - rankByName(b, q))
            .slice(0, 50)
    setFileResults(res)
    setSel(0)
  }, [query, files, mode])

  // Ricerca nei contenuti (debounce).
  useEffect(() => {
    if (mode !== 'content') return
    const q = query.trim()
    if (q.length < 2) {
      setContentResults([])
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(() => {
      searchContent(files, q).then((r) => {
        if (cancelled) return
        setContentResults(r)
        setSel(0)
        setSearching(false)
      })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query, files, mode])

  const results: Array<VaultFile | ContentMatch> = mode === 'files' ? fileResults : contentResults

  function openAt(i: number) {
    const r = results[i]
    if (!r) return
    // Aprendo da una ricerca nel contenuto, evidenzia il termine nell'editor.
    setPendingHighlight(mode === 'content' ? query.trim() : null)
    setSelectedFile(r.path)
    onClose()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      openAt(sel)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/50" onClick={onClose}>
      <div
        className="w-[34rem] max-w-[90vw] bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex border-b border-zinc-800 text-xs">
          <button
            onClick={() => setMode('files')}
            className={`px-3 py-2 ${mode === 'files' ? 'text-zinc-100 border-b-2 border-zinc-300' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            File
          </button>
          <button
            onClick={() => setMode('content')}
            className={`px-3 py-2 ${mode === 'content' ? 'text-zinc-100 border-b-2 border-zinc-300' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Contenuto
          </button>
        </div>

        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={mode === 'files' ? 'Cerca file per nome…' : 'Cerca nel contenuto…'}
          className="px-4 py-3 bg-transparent text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none border-b border-zinc-800"
        />

        <div className="max-h-80 overflow-y-auto py-1">
          {mode === 'content' && searching && (
            <div className="px-4 py-2 text-xs text-zinc-500">Ricerca…</div>
          )}
          {results.length === 0 && !searching && (
            <div className="px-4 py-3 text-xs text-zinc-600">
              {mode === 'content' && query.trim().length < 2
                ? 'Scrivi almeno 2 caratteri.'
                : 'Nessun risultato.'}
            </div>
          )}
          {results.map((r, i) => {
            const isContent = 'line' in r
            return (
              <button
                key={isContent ? `${r.path}:${(r as ContentMatch).line}` : r.path}
                ref={(el) => {
                  if (i === sel) el?.scrollIntoView({ block: 'nearest' })
                }}
                onClick={() => openAt(i)}
                onMouseEnter={() => setSel(i)}
                className={`w-full text-left px-4 py-2 flex flex-col gap-0.5 ${
                  i === sel ? 'bg-zinc-700' : 'hover:bg-zinc-800'
                }`}
              >
                <span className="text-sm text-zinc-200 truncate">{r.name}</span>
                {isContent ? (
                  <span className="text-xs text-zinc-500 truncate">
                    {(r as ContentMatch).rel}:{(r as ContentMatch).line} — {(r as ContentMatch).preview}
                  </span>
                ) : (
                  <span className="text-xs text-zinc-500 truncate">{(r as VaultFile).rel}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
