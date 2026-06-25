import { useEffect, useRef, useState } from 'react'
import { readFile } from '@tauri-apps/plugin-fs'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { formatSize } from '../../lib/imageMeta'
import { revealInExplorer } from '../../lib/imageActions'
// Worker bundlato localmente (niente CDN: resta tutto offline).
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker

const btn =
  'px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-zinc-300 disabled:opacity-40'

interface OutlineNode {
  title: string
  dest: string | unknown[] | null
  items: OutlineNode[]
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-zinc-500 shrink-0">{label}</span>
      <span className="text-zinc-200 truncate">{children}</span>
    </div>
  )
}

// Viewer PDF (sola lettura): scroll continuo, pagine renderizzate quando entrano
// in vista, zoom −/+/Adatta larghezza.
export function PdfViewer({ filePath }: { filePath: string }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [scale, setScale] = useState(1.2)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [sizeBytes, setSizeBytes] = useState(0)
  const [infoOpen, setInfoOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [navTab, setNavTab] = useState<'thumbs' | 'outline'>('thumbs')
  const [outline, setOutline] = useState<OutlineNode[] | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const baseWidthRef = useRef(0) // larghezza pagina 1 a scala 1 (per "Adatta")
  const scaleRef = useRef(scale)
  scaleRef.current = scale

  // Zoom con Ctrl+rotella, tenendo fermo il centro verticale del viewport
  // (le pagine restano centrate orizzontalmente dal layout flex).
  useEffect(() => {
    const cont = containerRef.current
    if (!cont) return
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      const s = scaleRef.current
      const ns = +Math.min(4, Math.max(0.3, s * factor)).toFixed(2)
      if (ns === s) return
      const centerY = cont!.clientHeight / 2
      const anchor = cont!.scrollTop + centerY
      const ratio = ns / s
      setScale(ns)
      requestAnimationFrame(() => {
        cont!.scrollTop = anchor * ratio - centerY
      })
    }
    cont.addEventListener('wheel', onWheel, { passive: false })
    return () => cont.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    let cancelled = false
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null
    setLoading(true)
    setError(false)
    setDoc(null)
    setNumPages(0)
    setOutline(null)
    ;(async () => {
      const bytes = await readFile(filePath)
      setSizeBytes(bytes.length)
      loadingTask = pdfjsLib.getDocument({ data: bytes })
      const pdf = await loadingTask.promise
      if (cancelled) return
      const page1 = await pdf.getPage(1)
      baseWidthRef.current = page1.getViewport({ scale: 1 }).width
      const cw = containerRef.current?.clientWidth ?? 800
      const fit = Math.min(2, Math.max(0.4, (cw - 48) / (baseWidthRef.current || 800)))
      setScale(+fit.toFixed(2))
      setDoc(pdf)
      setNumPages(pdf.numPages)
      setLoading(false)
      pdf
        .getOutline()
        .then((o) => {
          if (!cancelled) setOutline((o as OutlineNode[] | null) ?? null)
        })
        .catch(() => setOutline(null))
    })().catch((e) => {
      console.error('Errore apertura PDF:', e)
      if (!cancelled) {
        setError(true)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
      loadingTask?.destroy()
    }
  }, [filePath])

  function fitWidth() {
    if (!baseWidthRef.current) return
    const cw = containerRef.current?.clientWidth ?? 800
    setScale(+Math.min(2, Math.max(0.4, (cw - 48) / baseWidthRef.current)).toFixed(2))
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

  function scrollToPage(n: number) {
    document.getElementById(`pdfp-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function gotoDest(dest: string | unknown[] | null) {
    if (!dest || !doc) return
    try {
      const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest
      const ref = (explicit as unknown[] | null)?.[0]
      if (!ref) return
      const idx = await doc.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0])
      scrollToPage(idx + 1)
    } catch (e) {
      console.error('Destinazione PDF non risolta:', e)
    }
  }

  const raw = filePath.split('\\').pop() ?? ''
  let fileName = raw
  try {
    fileName = decodeURIComponent(raw) // path a volte URL-encoded (%20 -> spazio)
  } catch {
    /* nome con % non valido: tieni il grezzo */
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {sidebarOpen && (
        <aside className="w-56 shrink-0 border-r border-zinc-800 bg-zinc-900/40 flex flex-col overflow-hidden">
          <div className="flex border-b border-zinc-800 text-xs shrink-0">
            <button
              onClick={() => setNavTab('thumbs')}
              className={`flex-1 px-2 py-2 ${navTab === 'thumbs' ? 'text-zinc-100 bg-zinc-800/60' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Miniature
            </button>
            <button
              onClick={() => setNavTab('outline')}
              className={`flex-1 px-2 py-2 ${navTab === 'outline' ? 'text-zinc-100 bg-zinc-800/60' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Indice
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {navTab === 'thumbs'
              ? doc &&
                Array.from({ length: numPages }, (_, i) => (
                  <PdfThumb key={i + 1} doc={doc} pageNumber={i + 1} onClick={() => scrollToPage(i + 1)} />
                ))
              : outline && outline.length > 0
                ? <OutlineTree nodes={outline} onSelect={gotoDest} />
                : <p className="text-xs text-zinc-600 px-1 py-2">Nessun indice in questo PDF.</p>}
          </div>
        </aside>
      )}

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
      <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between gap-3 shrink-0">
        <span className="text-sm text-zinc-300 flex items-center gap-2 min-w-0">
          <button className={btn} title="Pannello navigazione" onClick={() => setSidebarOpen((o) => !o)}>
            ☰
          </button>
          <span className="truncate">{fileName}</span>
          {numPages > 0 && <span className="text-xs text-zinc-500 shrink-0">· {numPages} pagine</span>}
        </span>
        <div className="flex items-center gap-1 text-xs text-zinc-300">
          <button className={btn} title="Apri in Explorer" onClick={() => revealInExplorer(filePath).catch((e) => console.error(e))}>
            Explorer
          </button>
          <button className={infoOpen ? 'px-2 py-1 bg-zinc-100 text-zinc-900 border border-zinc-100 rounded' : btn} onClick={() => setInfoOpen((o) => !o)} title="Informazioni">
            ⓘ Info
          </button>
          <div className="w-px h-5 bg-zinc-700 mx-1" />
          <button className={btn} title="Riduci" onClick={() => setScale((s) => +Math.max(0.4, s - 0.2).toFixed(2))}>
            −
          </button>
          <span className="w-12 text-center text-zinc-400 tabular-nums">{Math.round(scale * 100)}%</span>
          <button className={btn} title="Ingrandisci" onClick={() => setScale((s) => +Math.min(4, s + 0.2).toFixed(2))}>
            +
          </button>
          <button className={btn} onClick={fitWidth}>
            Adatta
          </button>
        </div>
      </div>

      {infoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setInfoOpen(false)}>
          <div className="w-80 bg-zinc-900 border border-zinc-700 rounded-lg p-4 flex flex-col gap-3 text-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-zinc-200">Informazioni</h3>
            <Row label="Nome">{fileName}</Row>
            <Row label="Pagine">{numPages}</Row>
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

      <div ref={containerRef} className="flex-1 overflow-auto bg-zinc-900 flex flex-col items-center gap-5 px-6 py-7">
        {error && <span className="m-auto text-zinc-500 text-sm">Impossibile aprire il PDF.</span>}
        {loading && !error && (
          <div className="m-auto h-7 w-7 rounded-full border-2 border-zinc-700 border-t-zinc-400 animate-spin" />
        )}
        {doc &&
          Array.from({ length: numPages }, (_, i) => (
            <PdfPage key={i + 1} doc={doc} pageNumber={i + 1} scale={scale} />
          ))}
      </div>
      </div>
    </div>
  )
}

function PdfPage({ doc, pageNumber, scale }: { doc: PDFDocumentProxy; pageNumber: number; scale: number }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [visible, setVisible] = useState(false)

  // Dimensioni della pagina alla scala corrente (per il segnaposto = scroll corretto).
  useEffect(() => {
    let cancelled = false
    doc.getPage(pageNumber).then((page) => {
      const vp = page.getViewport({ scale })
      if (!cancelled) setSize({ w: Math.floor(vp.width), h: Math.floor(vp.height) })
    })
    return () => {
      cancelled = true
    }
  }, [doc, pageNumber, scale])

  // Renderizza solo quando la pagina è (quasi) in vista.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true)
      },
      { rootMargin: '400px 0px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let task: { promise: Promise<unknown>; cancel: () => void } | null = null
    let textLayer: { cancel: () => void } | null = null
    doc.getPage(pageNumber).then(async (page) => {
      if (cancelled) return
      const vp = page.getViewport({ scale })
      const canvas = canvasRef.current
      if (!canvas) return
      // Renderizza alla risoluzione del dispositivo (HiDPI) e ridimensiona via CSS:
      // così su schermi 2x/Retina non viene sgranato.
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(vp.width * dpr)
      canvas.height = Math.floor(vp.height * dpr)
      canvas.style.width = `${Math.floor(vp.width)}px`
      canvas.style.height = `${Math.floor(vp.height)}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
      task = page.render({ canvasContext: ctx, viewport: vp, transform, canvas })
      task.promise.catch(() => {}) // ignora le cancellazioni

      // Strato di testo selezionabile/copiabile sopra il canvas.
      const tlDiv = textLayerRef.current
      if (tlDiv) {
        tlDiv.replaceChildren()
        tlDiv.style.setProperty('--total-scale-factor', String(scale))
        tlDiv.style.width = `${Math.floor(vp.width)}px`
        tlDiv.style.height = `${Math.floor(vp.height)}px`
        const textContent = await page.getTextContent()
        if (cancelled) return
        const tl = new pdfjsLib.TextLayer({ textContentSource: textContent, container: tlDiv, viewport: vp })
        textLayer = tl
        tl.render().catch(() => {})
      }
    })
    return () => {
      cancelled = true
      task?.cancel()
      textLayer?.cancel()
    }
  }, [visible, doc, pageNumber, scale])

  return (
    <div
      ref={wrapRef}
      id={`pdfp-${pageNumber}`}
      style={{ width: size?.w, height: size?.h, scrollMarginTop: 16 }}
      className="relative bg-white rounded-md overflow-hidden shrink-0 ring-1 ring-black/5 shadow-[0_2px_16px_rgba(0,0,0,0.5)]"
    >
      <canvas ref={canvasRef} className="block" />
      <div ref={textLayerRef} className="textLayer" />
    </div>
  )
}

const THUMB_W = 150

// Miniatura di pagina (render piccolo e pigro) cliccabile.
function PdfThumb({ doc, pageNumber, onClick }: { doc: PDFDocumentProxy; pageNumber: number; onClick: () => void }) {
  const wrapRef = useRef<HTMLButtonElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let cancelled = false
    doc.getPage(pageNumber).then((page) => {
      const base = page.getViewport({ scale: 1 })
      const vp = page.getViewport({ scale: THUMB_W / base.width })
      if (!cancelled) setSize({ w: Math.floor(vp.width), h: Math.floor(vp.height) })
    })
    return () => {
      cancelled = true
    }
  }, [doc, pageNumber])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const obs = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setVisible(true), {
      rootMargin: '200px 0px',
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let task: { promise: Promise<unknown>; cancel: () => void } | null = null
    doc.getPage(pageNumber).then((page) => {
      if (cancelled) return
      const base = page.getViewport({ scale: 1 })
      const dpr = window.devicePixelRatio || 1
      const vp = page.getViewport({ scale: THUMB_W / base.width })
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = Math.floor(vp.width * dpr)
      canvas.height = Math.floor(vp.height * dpr)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
      task = page.render({ canvasContext: ctx, viewport: vp, transform, canvas })
      task.promise.catch(() => {})
    })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [visible, doc, pageNumber])

  return (
    <button ref={wrapRef} onClick={onClick} className="block w-full mb-3 group">
      <div
        style={{ width: size?.w, height: size?.h }}
        className="mx-auto bg-white rounded ring-1 ring-black/10 overflow-hidden group-hover:ring-2 group-hover:ring-blue-500"
      >
        <canvas ref={canvasRef} className="block w-full h-full" />
      </div>
      <span className="block text-center text-[11px] text-zinc-500 mt-1">{pageNumber}</span>
    </button>
  )
}

// Indice (bookmarks) del PDF, ricorsivo.
function OutlineTree({
  nodes,
  onSelect,
  depth = 0,
}: {
  nodes: OutlineNode[]
  onSelect: (dest: OutlineNode['dest']) => void
  depth?: number
}) {
  return (
    <ul className="text-xs">
      {nodes.map((n, i) => (
        <li key={i}>
          <button
            onClick={() => onSelect(n.dest)}
            className="block w-full text-left py-1 px-1 rounded text-zinc-300 hover:bg-zinc-800 truncate"
            style={{ paddingLeft: 4 + depth * 12 }}
            title={n.title}
          >
            {n.title}
          </button>
          {n.items && n.items.length > 0 && <OutlineTree nodes={n.items} onSelect={onSelect} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  )
}
