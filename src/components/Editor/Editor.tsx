import { useEffect, useState, useCallback } from 'react'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { marked } from 'marked'

type ViewMode = 'source' | 'reading'

function isMarkdown(path: string): boolean {
  const p = path.toLowerCase()
  return p.endsWith('.md') || p.endsWith('.markdown')
}

export function Editor({ filePath }: { filePath: string | null }) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<ViewMode>('source')

  // Carica il contenuto quando cambia il file selezionato.
  useEffect(() => {
    if (!filePath) {
      setContent('')
      setDirty(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setView('source')
    readTextFile(filePath)
      .then((text) => {
        if (cancelled) return
        setContent(text)
        setDirty(false)
        setLoading(false)
      })
      .catch((err) => {
        console.error('Errore lettura file:', err)
        if (cancelled) return
        setContent('')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [filePath])

  const handleSave = useCallback(async () => {
    if (!filePath || saving) return
    setSaving(true)
    try {
      await writeTextFile(filePath, content)
      setDirty(false)
    } catch (err) {
      console.error('Errore salvataggio file:', err)
    } finally {
      setSaving(false)
    }
  }, [filePath, content, saving])

  // Ctrl/Cmd+S per salvare.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleSave])

  // Risincronizza con il disco quando la finestra torna in focus: se il file è
  // stato modificato da fuori lo ricarica, ma solo se non ci sono modifiche locali
  // non salvate (per non sovrascriverle).
  useEffect(() => {
    if (!filePath) return
    function onFocus() {
      if (dirty) return
      readTextFile(filePath!)
        .then((text) => setContent((prev) => (prev === text ? prev : text)))
        .catch((err) => console.error('Errore risincronizzazione file:', err))
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [filePath, dirty])

  if (!filePath) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500">
        Seleziona un file dalla sidebar per iniziare.
      </div>
    )
  }

  const fileName = filePath.split('\\').pop()
  const markdown = isMarkdown(filePath)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between gap-3">
        <span className="text-sm text-zinc-400 truncate flex items-center gap-2">
          {dirty && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
              title="Modifiche non salvate"
            />
          )}
          {fileName}
        </span>

        <div className="flex items-center gap-2 shrink-0">
          {markdown && (
            <div className="flex rounded border border-zinc-700 overflow-hidden text-xs">
              <button
                onClick={() => setView('source')}
                className={`px-2 py-1 ${
                  view === 'source' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800'
                }`}
              >
                Codice
              </button>
              <button
                onClick={() => setView('reading')}
                className={`px-2 py-1 ${
                  view === 'reading' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800'
                }`}
              >
                Lettura
              </button>
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="px-3 py-1 bg-zinc-100 text-zinc-900 rounded text-xs font-medium hover:bg-white disabled:opacity-40 disabled:cursor-default transition-colors"
          >
            {saving ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-4 text-zinc-500 text-sm">Caricamento...</div>
      ) : markdown && view === 'reading' ? (
        <div className="flex-1 overflow-y-auto p-6">
          <div
            className="prose prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: marked.parse(content) as string }}
          />
        </div>
      ) : (
        <textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value)
            setDirty(true)
          }}
          spellCheck={false}
          className="flex-1 w-full bg-zinc-900 text-zinc-100 p-6 resize-none outline-none font-mono text-sm leading-relaxed"
        />
      )}
    </div>
  )
}
