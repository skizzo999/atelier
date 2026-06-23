import { useEffect, useState, useCallback, useRef } from 'react'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js/lib/common'
import 'highlight.js/styles/atom-one-dark.css'
import DOMPurify from 'dompurify'
import type { EditorView } from '@codemirror/view'
import { useAppStore } from '../../store/appStore'
import { writeFileAtomic } from '../../lib/fileOps'
import { loadImage } from '../../lib/images'
import { resolveOrCreateNote } from '../../lib/notes'
import { CodeMirrorEditor } from '../CodeMirror/CodeMirrorEditor'

// Evidenziazione sintassi nei blocchi di codice della vista Lettura (highlight.js).
marked.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext'
      return hljs.highlight(code, { language }).value
    },
  }),
)

// Estensione marked per ==evidenziato== (così la Lettura combacia con l'Ibrida).
marked.use({
  extensions: [
    {
      name: 'imageEmbed',
      level: 'inline',
      start(src: string) {
        return src.indexOf('![[')
      },
      tokenizer(src: string) {
        const m = /^!\[\[([^\]\n]+)\]\]/.exec(src)
        if (m) {
          return { type: 'imageEmbed', raw: m[0], text: m[1] }
        }
        return undefined
      },
      renderer(token) {
        const path = (token as unknown as { text: string }).text
        return `<img src="${path}" alt="${path}">`
      },
    },
    {
      name: 'highlight',
      level: 'inline',
      start(src: string) {
        return src.indexOf('==')
      },
      tokenizer(src: string) {
        const m = /^==([^=\n]+)==/.exec(src)
        if (m) {
          return { type: 'highlight', raw: m[0], text: m[1] }
        }
        return undefined
      },
      renderer(token) {
        return `<mark>${(token as unknown as { text: string }).text}</mark>`
      },
    },
    {
      name: 'wikilink',
      level: 'inline',
      start(src: string) {
        return src.indexOf('[[')
      },
      tokenizer(src: string) {
        const m = /^\[\[([^\]\n]+)\]\]/.exec(src)
        if (m) {
          const inner = m[1]
          const text = inner.includes('|') ? inner.split('|')[1] : inner
          const target = inner.split('|')[0]
          return { type: 'wikilink', raw: m[0], text, target }
        }
        return undefined
      },
      renderer(token) {
        const t = token as unknown as { text: string; target: string }
        return `<a class="wikilink" data-wikilink="${t.target}">${t.text}</a>`
      },
    },
  ],
})

// Converte le citazioni callout "> [!tipo] Titolo" in box stilizzati (vista Lettura).
function renderCallouts(html: string): string {
  return html.replace(
    /<blockquote>\s*<p>\s*\[!(\w+)\]([^<]*)/gi,
    (_m, type: string, rest: string) =>
      `<blockquote class="callout"><p class="callout-title">${type.toUpperCase()}</p><p>${rest.trim()}`,
  )
}

function isMarkdown(path: string): boolean {
  const p = path.toLowerCase()
  return p.endsWith('.md') || p.endsWith('.markdown')
}

export function Editor() {
  const filePath = useAppStore((s) => s.selectedFile)
  const setBuffer = useAppStore((s) => s.setBuffer)
  const clearBuffer = useAppStore((s) => s.clearBuffer)
  const pendingHighlight = useAppStore((s) => s.pendingHighlight)
  const setPendingHighlight = useAppStore((s) => s.setPendingHighlight)
  // Vista markdown persistita nello store (Codice/Ibrida/Lettura): l'app
  // riapre con l'ultima scelta invece di tornare sempre a Codice.
  const view = useAppStore((s) => s.mdView)
  const setView = useAppStore((s) => s.setMdView)
  // "dirty" derivato dallo store: c'è un buffer non salvato per questo file.
  const dirty = useAppStore((s) => filePath !== null && s.dirtyBuffers[filePath] !== undefined)

  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  // Path di cui `content` è effettivamente caricato (per sapere quando è pronto).
  const [loadedFilePath, setLoadedFilePath] = useState<string | null>(null)
  const editorViewRef = useRef<EditorView | null>(null)
  const readingRef = useRef<HTMLDivElement>(null)
  const fileDir = filePath ? filePath.slice(0, filePath.lastIndexOf('\\')) : ''

  // Carica il contenuto quando cambia il file: dal buffer se ci sono modifiche
  // non salvate, altrimenti dal disco.
  useEffect(() => {
    if (!filePath) {
      setContent('')
      setLoadedFilePath(null)
      return
    }

    const buffered = useAppStore.getState().dirtyBuffers[filePath]
    if (buffered !== undefined) {
      setContent(buffered)
      setLoading(false)
      setLoadedFilePath(filePath)
      return
    }

    let cancelled = false
    setLoading(true)
    readTextFile(filePath)
      .then((text) => {
        if (cancelled) return
        setContent(text)
        setLoading(false)
        setLoadedFilePath(filePath)
      })
      .catch((err) => {
        console.error('Errore lettura file:', err)
        if (cancelled) return
        setContent('')
        setLoading(false)
        setLoadedFilePath(filePath)
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

  // Click su un wikilink [[nota]]: apre la nota (o la crea se non esiste).
  const handleWikilink = useCallback(async (name: string) => {
    const st = useAppStore.getState()
    const fp = st.selectedFile
    const dir = fp ? fp.slice(0, fp.lastIndexOf('\\')) : (st.vaultPath ?? '')
    const path = await resolveOrCreateNote(name, dir)
    if (path) st.setSelectedFile(path)
  }, [])

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
  // scatta solo quando il contenuto del file corrente è effettivamente caricato,
  // poi seleziona la prima occorrenza in CodeMirror e scrolla alla sua riga.
  useEffect(() => {
    if (loadedFilePath !== filePath) return // contenuto non ancora del file corrente
    if (!pendingHighlight) return
    if (view !== 'reading') {
      const v = editorViewRef.current
      if (v) {
        const idx = content.toLowerCase().indexOf(pendingHighlight.toLowerCase())
        if (idx >= 0) {
          v.dispatch({
            selection: { anchor: idx, head: idx + pendingHighlight.length },
            scrollIntoView: true,
          })
          v.focus()
        }
      }
    }
    setPendingHighlight(null)
  }, [pendingHighlight, loadedFilePath, filePath, view, content, setPendingHighlight])

  // Vista Lettura: carica le immagini locali (path relativi al file) come blob.
  useEffect(() => {
    if (view !== 'reading' || !filePath) return
    const container = readingRef.current
    if (!container) return
    const dir = filePath.slice(0, filePath.lastIndexOf('\\'))
    const urls: string[] = []
    let cancelled = false
    container.querySelectorAll('img').forEach((img) => {
      const raw = img.getAttribute('src') || ''
      if (!raw || /^(https?:|data:|blob:)/i.test(raw)) return
      loadImage(raw, dir).then((url) => {
        if (cancelled || !url) return
        urls.push(url)
        img.src = url
      })
    })
    return () => {
      cancelled = true
      urls.forEach(URL.revokeObjectURL)
    }
  }, [view, content, filePath])

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
                onClick={() => setView('live')}
                className={`px-2 py-1 border-l border-zinc-700 ${
                  view === 'live' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800'
                }`}
              >
                Ibrida
              </button>
              <button
                onClick={() => setView('reading')}
                className={`px-2 py-1 border-l border-zinc-700 ${
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
            ref={readingRef}
            className="prose prose-invert max-w-none"
            onClick={(e) => {
              const a = (e.target as HTMLElement).closest('a.wikilink') as HTMLElement | null
              if (a) {
                e.preventDefault()
                handleWikilink(a.getAttribute('data-wikilink') || a.textContent || '')
              }
            }}
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(renderCallouts(marked.parse(content) as string)),
            }}
          />
        </div>
      ) : (
        <CodeMirrorEditor
          value={content}
          markdownMode={markdown}
          livePreviewMode={markdown && view === 'live'}
          fileDir={fileDir}
          onWikilink={handleWikilink}
          viewRef={editorViewRef}
          onChange={(v) => {
            setContent(v)
            setBuffer(filePath, v)
          }}
        />
      )}
    </div>
  )
}
