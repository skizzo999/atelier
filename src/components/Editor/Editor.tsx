import { useEffect, useState, useCallback, useRef } from 'react'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useAppStore } from '../../store/appStore'
import { writeFileAtomic } from '../../lib/fileOps'

type ViewMode = 'source' | 'reading'

function isMarkdown(path: string): boolean {
  const p = path.toLowerCase()
  return p.endsWith('.md') || p.endsWith('.markdown')
}

export function Editor() {
  const filePath = useAppStore((s) => s.selectedFile)
  const setBuffer = useAppStore((s) => s.setBuffer)
  const clearBuffer = useAppStore((s) => s.clearBuffer)
  // "dirty" derivato dallo store: c'è un buffer non salvato per questo file.
  const dirty = useAppStore((s) => filePath !== null && s.dirtyBuffers[filePath] !== undefined)

  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<ViewMode>('source')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Carica il contenuto quando cambia il file: dal buffer se ci sono modifiche
  // non salvate, altrimenti dal disco.
  useEffect(() => {
    if (!filePath) {
      setContent('')
      return
    }

    setView('source')
    const buffered = useAppStore.getState().dirtyBuffers[filePath]
    if (buffered !== undefined) {
      setContent(buffered)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    readTextFile(filePath)
      .then((text) => {
        if (cancelled) return
        setContent(text)
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
      await writeFileAtomic(filePath, content)
      clearBuffer(filePath)
    } catch (err) {
      console.error('Errore salvataggio file:', err)
    } finally {
      setSaving(false)
    }
  }, [filePath, content, saving, clearBuffer])

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

  // Risincronizza con il disco quando la finestra torna in focus, solo se non
  // ci sono modifiche locali non salvate (per non sovrascriverle).
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

  // Highlight one-shot del termine cercato (apertura da ricerca nel contenuto):
  // seleziona la prima occorrenza nella textarea e scrolla alla sua riga.
  useEffect(() => {
    if (loading || !filePath) return
    const term = useAppStore.getState().pendingHighlight
    if (!term) return
    const ta = textareaRef.current
    if (ta && view === 'source') {
      const idx = content.toLowerCase().indexOf(term.toLowerCase())
      if (idx >= 0) {
        ta.focus()
        ta.setSelectionRange(idx, idx + term.length)
        const line = content.slice(0, idx).split('\n').length - 1
        const totalLines = content.split('\n').length || 1
        const lineHeight = ta.scrollHeight / totalLines
        ta.scrollTop = Math.max(0, line * lineHeight - ta.clientHeight / 2)
      }
    }
    useAppStore.getState().setPendingHighlight(null)
  }, [content, loading, view, filePath])

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
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(marked.parse(content) as string),
            }}
          />
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => {
            const value = e.target.value
            setContent(value)
            setBuffer(filePath, value)
          }}
          spellCheck={false}
          className="flex-1 w-full bg-zinc-900 text-zinc-100 p-6 resize-none outline-none font-mono text-sm leading-relaxed"
        />
      )}
    </div>
  )
}
