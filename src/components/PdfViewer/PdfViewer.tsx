import { useEffect, useRef, useState } from 'react'
import { readFile } from '@tauri-apps/plugin-fs'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { formatSize } from '../../lib/imageMeta'
import { revealInExplorer } from '../../lib/imageActions'
import { ocrCanvasWords, type OcrWord } from '../../lib/pdfOcr'
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
  // OCR delle pagine scansionate: parola → box in coord a scala 1 (punti PDF).
  const [ocrPages, setOcrPages] = useState<Map<number, OcrWord[]>>(new Map())
  const [ocr, setOcr] = useState<{ done: number; total: number } | null>(null)
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
    setOcrPages(new Map())
    setOcr(null)
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

  // OCR automatico in background sulle pagine senza testo (scansioni): le
  // riconosce una alla volta e costruisce uno strato di testo selezionabile.
  useEffect(() => {
    if (!doc || !numPages) return
    let cancelled = false
    const canvas = document.createElement('canvas')
    ;(async () => {
      // Trova le pagine prive di testo (= scansioni/immagini).
      const scanned: number[] = []
      for (let n = 1; n <= numPages; n++) {
        if (cancelled) return
        const page = await doc.getPage(n)
        const tc = await page.getTextContent()
        if (tc.items.length === 0) scanned.push(n)
      }
      if (cancelled || scanned.length === 0) return
      setOcr({ done: 0, total: scanned.length })
      for (let i = 0; i < scanned.length; i++) {
        if (cancelled) return
        const n = scanned[i]
        const page = await doc.getPage(n)
        const base = page.getViewport({ scale: 1 })
        const ocrScale = Math.min(3, 1600 / base.width) // ~1600px = buona resa OCR
        const vp = page.getViewport({ scale: ocrScale })
        canvas.width = Math.floor(vp.width)
        canvas.height = Math.floor(vp.height)
        const ctx = canvas.getContext('2d')
        if (!ctx) continue
        await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise
        if (cancelled) return
        const words = await ocrCanvasWords(canvas)
        if (cancelled) return
        // Box in coord a scala 1 (punti PDF), indipendenti dallo zoom.
        const inPts = words.map((w) => ({
          text: w.text,
          x0: w.x0 / ocrScale,
          y0: w.y0 / ocrScale,
          x1: w.x1 / ocrScale,
          y1: w.y1 / ocrScale,
        }))
        setOcrPages((prev) => new Map(prev).set(n, inPts))
        setOcr({ done: i + 1, total: scanned.length })
      }
      if (!cancelled) setOcr(null)
    })().catch((e) => {
      console.error('OCR PDF:', e)
      if (!cancelled) setOcr(null)
    })
    return () => {
      cancelled = true
    }
  }, [doc, numPages])

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
          {ocr && (
            <span className="text-xs text-blue-300 shrink-0 flex items-center gap-1" title="Riconoscimento testo sulle pagine scansionate">
              <span className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
              OCR {ocr.done}/{ocr.total}
            </span>
          )}
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
            <PdfPage key={i + 1} doc={doc} pageNumber={i + 1} scale={scale} ocrWords={ocrPages.get(i + 1)} />
          ))}
      </div>
      </div>
    </div>
  )
}

// Costruisce uno strato di testo invisibile dalle parole OCR (coord a scala 1),
// posizionate alla scala di render; seconda passata = stira ogni parola alla
// larghezza del suo box per una selezione/evidenziazione precisa.
function buildOcrLayer(div: HTMLDivElement, words: OcrWord[], scale: number) {
  div.className = 'ocrLayer'
  div.replaceChildren()
  const frag = document.createDocumentFragment()
  const spans: { el: HTMLSpanElement; w: number }[] = []
  for (const word of words) {
    const w = (word.x1 - word.x0) * scale
    const h = (word.y1 - word.y0) * scale
    if (w <= 0 || h <= 0) continue
    const span = document.createElement('span')
    span.textContent = word.text
    span.style.left = `${word.x0 * scale}px`
    span.style.top = `${word.y0 * scale}px`
    span.style.fontSize = `${h * 0.92}px`
    frag.appendChild(span)
    spans.push({ el: span, w })
  }
  div.appendChild(frag)
  for (const { el, w } of spans) {
    const natural = el.offsetWidth
    if (natural > 0) el.style.transform = `scaleX(${w / natural})`
  }
}

function PdfPage({
  doc,
  pageNumber,
  scale,
  ocrWords,
}: {
  doc: PDFDocumentProxy
  pageNumber: number
  scale: number
  ocrWords?: OcrWord[]
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  // Segnaposto alla scala TARGET (layout/scroll immediati).
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  // Scala a cui il contenuto è davvero rasterizzato (in ritardo = debounce).
  const [renderScale, setRenderScale] = useState(scale)
  // Dimensioni del contenuto alla renderScale (per lo scale CSS dello zoom).
  const [renderSize, setRenderSize] = useState<{ w: number; h: number } | null>(null)
  const [visible, setVisible] = useState(false)

  // Durante lo zoom ri-rasterizza solo quando ci si ferma (niente lag per scatto).
  useEffect(() => {
    if (renderScale === scale) return
    const t = setTimeout(() => setRenderScale(scale), 160)
    return () => clearTimeout(t)
  }, [scale, renderScale])

  // Segnaposto alla scala target (immediato, così lo scroll è giusto).
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

  // Render solo quando (quasi) in vista.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const obs = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), {
      rootMargin: '500px 0px',
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Rasterizza il canvas alla renderScale (HiDPI).
  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let task: { promise: Promise<unknown>; cancel: () => void } | null = null
    doc.getPage(pageNumber).then((page) => {
      if (cancelled) return
      const vp = page.getViewport({ scale: renderScale })
      setRenderSize({ w: Math.floor(vp.width), h: Math.floor(vp.height) })
      const canvas = canvasRef.current
      if (!canvas) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(vp.width * dpr)
      canvas.height = Math.floor(vp.height * dpr)
      canvas.style.width = `${Math.floor(vp.width)}px`
      canvas.style.height = `${Math.floor(vp.height)}px`
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
  }, [visible, doc, pageNumber, renderScale])

  // Strato di testo selezionabile: OCR (scansioni) oppure pdf.js (PDF di testo).
  useEffect(() => {
    if (!visible) return
    const tlDiv = textLayerRef.current
    if (!tlDiv) return
    let cancelled = false
    let textLayer: { cancel: () => void } | null = null
    if (ocrWords && ocrWords.length) {
      buildOcrLayer(tlDiv, ocrWords, renderScale)
    } else {
      tlDiv.className = 'textLayer'
      tlDiv.replaceChildren()
      doc.getPage(pageNumber).then(async (page) => {
        if (cancelled) return
        const vp = page.getViewport({ scale: renderScale })
        const textContent = await page.getTextContent()
        if (cancelled || textContent.items.length === 0) return // scansione: aspetta l'OCR
        tlDiv.style.setProperty('--total-scale-factor', String(renderScale))
        tlDiv.style.width = `${Math.floor(vp.width)}px`
        tlDiv.style.height = `${Math.floor(vp.height)}px`
        const tl = new pdfjsLib.TextLayer({ textContentSource: textContent, container: tlDiv, viewport: vp })
        textLayer = tl
        tl.render().catch(() => {})
      })
    }
    return () => {
      cancelled = true
      textLayer?.cancel()
    }
  }, [visible, doc, pageNumber, renderScale, ocrWords])

  // Zoom istantaneo: scala via CSS dal contenuto (renderScale) alla scala target.
  const k = renderSize && size && renderSize.w ? size.w / renderSize.w : 1

  return (
    <div
      ref={wrapRef}
      id={`pdfp-${pageNumber}`}
      style={{ width: size?.w, height: size?.h, scrollMarginTop: 16 }}
      className="relative bg-white rounded-md overflow-hidden shrink-0 ring-1 ring-black/5 shadow-[0_2px_16px_rgba(0,0,0,0.5)]"
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: renderSize?.w,
          height: renderSize?.h,
          transform: k !== 1 ? `scale(${k})` : undefined,
          transformOrigin: '0 0',
        }}
      >
        <canvas ref={canvasRef} className="block" />
        <div ref={textLayerRef} className="textLayer" />
      </div>
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
