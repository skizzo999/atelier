import { useEffect, useRef, useState } from 'react'
import { readFile, writeTextFile, exists } from '@tauri-apps/plugin-fs'
import DOMPurify from 'dompurify'
import * as mammoth from 'mammoth'
import { formatSize } from '../../lib/imageMeta'
import { revealInExplorer } from '../../lib/imageActions'
import { useAppStore } from '../../store/appStore'

const btn =
  'px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-zinc-300 disabled:opacity-40'
const btnActive = 'px-2 py-1 bg-zinc-100 text-zinc-900 border border-zinc-100 rounded'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-zinc-500 shrink-0">{label}</span>
      <span className="text-zinc-200 truncate">{children}</span>
    </div>
  )
}

// Toglie le evidenziazioni di ricerca precedenti (riunisce i nodi di testo).
function clearMarks(root: HTMLElement) {
  root.querySelectorAll('mark.docx-find').forEach((m) => {
    const parent = m.parentNode
    if (parent) {
      parent.replaceChild(document.createTextNode(m.textContent || ''), m)
      parent.normalize()
    }
  })
}

// Avvolge le occorrenze della query in <mark> e ne restituisce l'elenco.
function addMarks(root: HTMLElement, query: string): HTMLElement[] {
  const q = query.toLowerCase()
  const marks: HTMLElement[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let n: Node | null
  while ((n = walker.nextNode())) nodes.push(n as Text)
  for (const node of nodes) {
    const text = node.nodeValue || ''
    const lower = text.toLowerCase()
    let idx = lower.indexOf(q)
    if (idx < 0) continue
    const frag = document.createDocumentFragment()
    let last = 0
    while (idx >= 0) {
      if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)))
      const mark = document.createElement('mark')
      mark.className = 'docx-find'
      mark.textContent = text.slice(idx, idx + q.length)
      frag.appendChild(mark)
      marks.push(mark)
      last = idx + q.length
      idx = lower.indexOf(q, last)
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))
    node.parentNode?.replaceChild(frag, node)
  }
  return marks
}

// Viewer DOCX (sola lettura): Mammoth converte il .docx in HTML semantico,
// reso come la vista Lettura. Con pannello Info, ricerca (Ctrl+F) ed export in Markdown.
export function DocxViewer({ filePath }: { filePath: string }) {
  const setSelectedFile = useAppStore((s) => s.setSelectedFile)
  const setPendingHighlight = useAppStore((s) => s.setPendingHighlight)
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [sizeBytes, setSizeBytes] = useState(0)
  const [words, setWords] = useState(0)
  const [infoOpen, setInfoOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [current, setCurrent] = useState(0)
  const contentRef = useRef<HTMLDivElement>(null)
  const marksRef = useRef<HTMLElement[]>([])
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setHtml('')
    setSearchOpen(false)
    setQuery('')
    ;(async () => {
      const bytes = await readFile(filePath)
      setSizeBytes(bytes.length)
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const result = await mammoth.convertToHtml({ arrayBuffer })
      if (cancelled) return
      setHtml(DOMPurify.sanitize(result.value))
      setLoading(false)
    })().catch((e) => {
      console.error('Errore apertura DOCX:', e)
      if (!cancelled) {
        setError(true)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [filePath])

  // Aperto da una ricerca globale: apri la ricerca col termine (le evidenziazioni
  // compaiono appena l'HTML è pronto, grazie alla dipendenza da `html`).
  useEffect(() => {
    const term = useAppStore.getState().pendingHighlight
    if (term && term.trim().length >= 2) {
      setQuery(term)
      setSearchOpen(true)
      setPendingHighlight(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath])

  // Conteggio parole dal testo reso.
  useEffect(() => {
    if (!html) return setWords(0)
    const text = contentRef.current?.textContent ?? ''
    setWords(text.trim() ? text.trim().split(/\s+/).length : 0)
  }, [html])

  // Ctrl+F apre la ricerca nel documento.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setSearchOpen(true)
        requestAnimationFrame(() => searchInputRef.current?.select())
      } else if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchOpen])

  // Evidenzia le occorrenze (debounce) e salta alla prima.
  useEffect(() => {
    const root = contentRef.current
    if (!root) return
    clearMarks(root)
    marksRef.current = []
    setMatchCount(0)
    setCurrent(0)
    const q = query.trim()
    if (!searchOpen || q.length < 2) return
    const t = setTimeout(() => {
      const r = contentRef.current
      if (!r) return
      const marks = addMarks(r, q)
      marksRef.current = marks
      setMatchCount(marks.length)
      if (marks.length) {
        marks[0].classList.add('docx-find-current')
        marks[0].scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    }, 250)
    return () => clearTimeout(t)
  }, [query, searchOpen, html])

  function goTo(delta: number) {
    const marks = marksRef.current
    if (!marks.length) return
    marks[current]?.classList.remove('docx-find-current')
    const next = (current + delta + marks.length) % marks.length
    setCurrent(next)
    marks[next].classList.add('docx-find-current')
    marks[next].scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(filePath)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch (e) {
      console.error(e)
    }
  }

  // Export in Markdown: scrive un .md accanto al .docx (nome libero) e lo apre.
  async function exportMarkdown() {
    if (exporting) return
    setExporting(true)
    try {
      const bytes = await readFile(filePath)
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      // convertToMarkdown esiste a runtime ma non è nei tipi di mammoth.
      const toMd = (mammoth as unknown as {
        convertToMarkdown: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>
      }).convertToMarkdown
      const md = await toMd({ arrayBuffer })
      const dir = filePath.slice(0, filePath.lastIndexOf('\\'))
      const base = fileName.replace(/\.docx$/i, '')
      let dest = `${dir}\\${base}.md`
      let i = 2
      while (await exists(dest)) {
        dest = `${dir}\\${base} (${i}).md`
        i++
      }
      await writeTextFile(dest, md.value)
      setSelectedFile(dest)
    } catch (e) {
      console.error('Export DOCX→MD:', e)
    } finally {
      setExporting(false)
    }
  }

  const raw = filePath.split('\\').pop() ?? ''
  let fileName = raw
  try {
    fileName = decodeURIComponent(raw)
  } catch {
    /* nome con % non valido: tieni il grezzo */
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {searchOpen && (
        <div className="absolute top-2 right-4 z-20 flex items-center gap-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl px-2 py-1.5">
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                goTo(e.shiftKey ? -1 : 1)
              } else if (e.key === 'Escape') {
                setSearchOpen(false)
              }
            }}
            placeholder="Cerca nel documento…"
            className="bg-transparent text-sm text-zinc-100 w-48 px-1 focus:outline-none placeholder:text-zinc-600"
          />
          <span className="text-xs text-zinc-500 tabular-nums w-14 text-center shrink-0">
            {matchCount ? `${current + 1}/${matchCount}` : query.trim().length >= 2 ? '0/0' : ''}
          </span>
          <button className={btn} title="Precedente (Shift+Invio)" onClick={() => goTo(-1)} disabled={!matchCount}>
            ↑
          </button>
          <button className={btn} title="Successivo (Invio)" onClick={() => goTo(1)} disabled={!matchCount}>
            ↓
          </button>
          <button className={btn} title="Chiudi (Esc)" onClick={() => setSearchOpen(false)}>
            ✕
          </button>
        </div>
      )}

      <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between gap-3 shrink-0">
        <span className="text-sm text-zinc-300 truncate flex items-center gap-2 min-w-0">
          <span className="truncate">{fileName}</span>
        </span>
        <div className="flex items-center gap-1 text-xs text-zinc-300">
          <button className={btn} title="Esporta in Markdown" disabled={exporting || loading} onClick={exportMarkdown}>
            {exporting ? 'Esporto…' : '↧ Esporta .md'}
          </button>
          <button className={infoOpen ? btnActive : btn} onClick={() => setInfoOpen((o) => !o)} title="Informazioni">
            ⓘ Info
          </button>
          <button className={btn} title="Apri in Explorer" onClick={() => revealInExplorer(filePath).catch((e) => console.error(e))}>
            Explorer
          </button>
        </div>
      </div>

      {infoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setInfoOpen(false)}>
          <div className="w-80 bg-zinc-900 border border-zinc-700 rounded-lg p-4 flex flex-col gap-3 text-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-zinc-200">Informazioni</h3>
            <Row label="Nome">{fileName}</Row>
            <Row label="Parole">{words.toLocaleString('it-IT')}</Row>
            <Row label="Peso">{formatSize(sizeBytes)}</Row>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500">Percorso</span>
              <p className="text-xs text-zinc-400 break-all font-mono leading-snug">{filePath}</p>
            </div>
            <div className="flex gap-2 justify-end">
              <button className={btn} onClick={copyPath}>
                {copied ? 'Copiato ✓' : 'Copia percorso'}
              </button>
              <button onClick={() => setInfoOpen(false)} className="px-3 py-1 bg-zinc-100 text-zinc-900 rounded font-medium hover:bg-white">
                Chiudi
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto bg-zinc-900 py-8 px-6">
        {error && <p className="text-zinc-500 text-sm text-center">Impossibile aprire il documento.</p>}
        {loading && !error && (
          <div className="mx-auto h-7 w-7 rounded-full border-2 border-zinc-700 border-t-zinc-400 animate-spin" />
        )}
        <div
          ref={contentRef}
          className={`prose prose-invert max-w-3xl mx-auto ${loading || error ? 'hidden' : ''}`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  )
}
