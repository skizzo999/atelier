import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { readFile } from '@tauri-apps/plugin-fs'
import { writeFileBinaryAtomic, uniquePathWithSuffix } from '../../lib/fileOps'
import { useAppStore } from '../../store/appStore'
import {
  arrowGeometry,
  drawShapesToCtx,
  type AnnotTool,
  type Shape,
  type ShapeKind,
} from '../../lib/annotations'

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
}

// Formati raster ri-encodabili da canvas (toBlob): supportano l'editing.
const EDITABLE = new Set(['png', 'jpg', 'jpeg', 'webp'])

function extOf(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? ''
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

export function ImageViewer({ filePath }: { filePath: string }) {
  return EDITABLE.has(extOf(filePath)) ? (
    <EditableImage filePath={filePath} />
  ) : (
    <ViewOnlyImage filePath={filePath} />
  )
}

// --- Trasformazioni su canvas (ognuna ritorna un nuovo canvas) ---

function rotate90(src: HTMLCanvasElement, dir: 1 | -1): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = src.height
  c.height = src.width
  const ctx = c.getContext('2d')!
  ctx.translate(c.width / 2, c.height / 2)
  ctx.rotate((dir * Math.PI) / 2)
  ctx.drawImage(src, -src.width / 2, -src.height / 2)
  return c
}

function flip(src: HTMLCanvasElement, axis: 'h' | 'v'): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height
  const ctx = c.getContext('2d')!
  ctx.translate(axis === 'h' ? c.width : 0, axis === 'v' ? c.height : 0)
  ctx.scale(axis === 'h' ? -1 : 1, axis === 'v' ? -1 : 1)
  ctx.drawImage(src, 0, 0)
  return c
}

function resizeCanvas(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, w, h)
  return c
}

function cropCanvas(
  src: HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = sw
  c.height = sh
  c.getContext('2d')!.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh)
  return c
}

const toolBtn =
  'px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-zinc-300 disabled:opacity-40'
const activeChip = 'px-2 py-1 bg-zinc-100 text-zinc-900 border border-zinc-100 rounded font-medium'

interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

// Palette per le annotazioni.
const ANNOT_COLORS = ['#ef4444', '#f59e0b', '#facc15', '#22c55e', '#3b82f6', '#ffffff', '#000000']
type Thickness = 'S' | 'M' | 'L'

// Copia un canvas (per disegnarci sopra senza toccare l'originale).
function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height
  c.getContext('2d')!.drawImage(src, 0, 0)
  return c
}

interface ViewState {
  scale: number
  tx: number
  ty: number
}

// Viewport condiviso (zoom verso il cursore + pan trascinando) per i viewer
// immagine. Il contenuto va messo in un "palco" con
// transform: translate(tx,ty) scale(scale) e transformOrigin 0 0.
function useImageViewport(
  containerRef: React.RefObject<HTMLDivElement | null>,
  dims: { w: number; h: number },
  wheelEnabled: boolean,
) {
  const [view, setView] = useState<ViewState>({ scale: 1, tx: 0, ty: 0 })
  const viewRef = useRef(view)
  viewRef.current = view
  const panning = useRef(false)
  const panStart = useRef<{ cx: number; cy: number; tx: number; ty: number } | null>(null)

  function fitView(w: number = dims.w, h: number = dims.h) {
    const cont = containerRef.current
    if (!cont || !w || !h) return
    const cr = cont.getBoundingClientRect()
    const pad = 24
    const scale = Math.min((cr.width - pad) / w, (cr.height - pad) / h)
    setView({ scale, tx: (cr.width - w * scale) / 2, ty: (cr.height - h * scale) / 2 })
  }
  // Zoom mantenendo fermo il punto sotto le coordinate (cx,cy) nel contenitore.
  function zoomAt(cx: number, cy: number, factor: number) {
    const v = viewRef.current
    const scale = Math.min(32, Math.max(0.05, v.scale * factor))
    const k = scale / v.scale
    setView({ scale, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k })
  }
  function zoomBy(factor: number) {
    const cont = containerRef.current
    if (!cont) return
    const cr = cont.getBoundingClientRect()
    zoomAt(cr.width / 2, cr.height / 2, factor)
  }
  function onViewDown(e: React.PointerEvent) {
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    panning.current = true
    const v = viewRef.current
    panStart.current = { cx: e.clientX, cy: e.clientY, tx: v.tx, ty: v.ty }
  }
  function onViewMove(e: React.PointerEvent) {
    if (!panning.current || !panStart.current) return
    const s = panStart.current
    setView((v) => ({ ...v, tx: s.tx + (e.clientX - s.cx), ty: s.ty + (e.clientY - s.cy) }))
  }
  function onViewUp() {
    panning.current = false
    panStart.current = null
  }

  // Riadatta quando cambiano le dimensioni del contenuto.
  useLayoutEffect(() => {
    fitView()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dims.w, dims.h])

  // Zoom con la rotella verso il cursore (listener nativo per poter preventDefault).
  useEffect(() => {
    if (!wheelEnabled) return
    const cont = containerRef.current
    if (!cont) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const cr = cont!.getBoundingClientRect()
      zoomAt(e.clientX - cr.left, e.clientY - cr.top, e.deltaY < 0 ? 1.1 : 1 / 1.1)
    }
    cont.addEventListener('wheel', onWheel, { passive: false })
    return () => cont.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wheelEnabled])

  return { view, setView, viewRef, panning, panStart, fitView, zoomBy, onViewDown, onViewMove, onViewUp }
}

function EditableImage({ filePath }: { filePath: string }) {
  const ext = extOf(filePath)
  const setImageBuffer = useAppStore((s) => s.setImageBuffer)
  const clearImageBuffer = useAppStore((s) => s.clearImageBuffer)
  const setSelectedFile = useAppStore((s) => s.setSelectedFile)
  const penPresets = useAppStore((s) => s.penPresets)
  const setPenPreset = useAppStore((s) => s.setPenPreset)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dims, setDims] = useState({ w: 0, h: 0 })
  const [reloadNonce, setReloadNonce] = useState(0)
  const [resizeOpen, setResizeOpen] = useState(false)
  const [cropMode, setCropMode] = useState(false)
  const [cropRect, setCropRect] = useState<CropRect | null>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const dragging = useRef(false)

  // --- Annotazioni ---
  const [annotMode, setAnnotMode] = useState(false)
  const [tool, setTool] = useState<AnnotTool>('pen1')
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect')
  const [color, setColor] = useState(ANNOT_COLORS[0])
  const [thickness, setThickness] = useState<Thickness>('M')
  const [shapes, setShapes] = useState<Shape[]>([])
  const [draft, setDraft] = useState<Shape | null>(null)
  // Valore autoritativo del draft (sincrono): evita closure stale e doppie
  // aggiunte da StrictMode (niente effetti dentro gli updater di setState).
  const draftRef = useRef<Shape | null>(null)
  const [textDraft, setTextDraft] = useState<
    { x: number; y: number; size: number; color: string; value: string } | null
  >(null)
  const spaceHeld = useRef(false)
  const cancelText = useRef(false)
  const textInputRef = useRef<HTMLInputElement>(null)

  // Viewport zoom/pan condiviso (rotella disabilitata durante il ritaglio).
  const { view, setView, viewRef, panning, panStart, fitView, zoomBy, onViewDown, onViewMove, onViewUp } =
    useImageViewport(containerRef, dims, !cropMode)

  // Carica dal buffer (modifiche non salvate) se presente, altrimenti dal disco.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setCropMode(false)
    setCropRect(null)
    setAnnotMode(false)
    setShapes([])
    setDraft(null)
    setTextDraft(null)
    const buffered = useAppStore.getState().imageBuffers[filePath]
    ;(async () => {
      let blob: Blob
      if (buffered) {
        blob = buffered
      } else {
        const bytes = await readFile(filePath)
        blob = new Blob([bytes], { type: MIME[ext] ?? 'image/png' })
      }
      const bmp = await createImageBitmap(blob)
      if (cancelled) {
        bmp.close()
        return
      }
      const cv = canvasRef.current
      if (cv) {
        cv.width = bmp.width
        cv.height = bmp.height
        cv.getContext('2d')!.drawImage(bmp, 0, 0)
        setDims({ w: bmp.width, h: bmp.height })
        fitView(bmp.width, bmp.height) // adatta la nuova immagine al contenitore
      }
      bmp.close()
      setDirty(!!buffered)
      setLoading(false)
    })().catch((err) => {
      console.error('Errore lettura immagine:', err)
      if (!cancelled) {
        setError(true)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [filePath, ext, reloadNonce])

  function applyTransform(produce: (src: HTMLCanvasElement) => HTMLCanvasElement) {
    const cv = canvasRef.current
    if (!cv) return
    const result = produce(cv)
    cv.width = result.width
    cv.height = result.height
    const ctx = cv.getContext('2d')!
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.drawImage(result, 0, 0)
    setDims({ w: cv.width, h: cv.height })
    setDirty(true)
    // Aggiorna il buffer (PNG lossless) così le modifiche sopravvivono al cambio file.
    cv.toBlob((b) => {
      if (b) setImageBuffer(filePath, b)
    }, 'image/png')
  }

  function handleSave() {
    const cv = canvasRef.current
    if (!cv || saving) return
    setSaving(true)
    cv.toBlob(
      async (blob) => {
        try {
          if (!blob) throw new Error('Encoding fallito')
          const buf = new Uint8Array(await blob.arrayBuffer())
          await writeFileBinaryAtomic(filePath, buf)
          clearImageBuffer(filePath)
          setDirty(false)
        } catch (err) {
          console.error('Errore salvataggio immagine:', err)
        } finally {
          setSaving(false)
        }
      },
      MIME[ext] ?? 'image/png',
      0.92,
    )
  }

  // Ctrl/Cmd+S salva l'immagine.
  const saveRef = useRef(handleSave)
  saveRef.current = handleSave
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // --- Crop interattivo ---
  function startCrop() {
    fitView() // ritaglio su vista adattata
    setCropRect(null)
    setCropMode(true)
  }
  function cancelCrop() {
    setCropMode(false)
    setCropRect(null)
    dragging.current = false
  }
  function onCropDown(e: React.MouseEvent) {
    const cv = canvasRef.current
    if (!cv) return
    const r = cv.getBoundingClientRect()
    const x = clamp(e.clientX - r.left, 0, r.width)
    const y = clamp(e.clientY - r.top, 0, r.height)
    dragStart.current = { x, y }
    dragging.current = true
    setCropRect({ x, y, w: 0, h: 0 })
  }
  function onCropMove(e: React.MouseEvent) {
    if (!dragging.current) return
    const cv = canvasRef.current
    const s = dragStart.current
    if (!cv || !s) return
    const r = cv.getBoundingClientRect()
    const x2 = clamp(e.clientX - r.left, 0, r.width)
    const y2 = clamp(e.clientY - r.top, 0, r.height)
    setCropRect({
      x: Math.min(s.x, x2),
      y: Math.min(s.y, y2),
      w: Math.abs(x2 - s.x),
      h: Math.abs(y2 - s.y),
    })
  }
  function onCropUp() {
    dragging.current = false
  }
  // Converte il rettangolo di selezione (coord display) in coord pixel sull'immagine.
  function cropRegion(): { sx: number; sy: number; sw: number; sh: number } | null {
    const cv = canvasRef.current
    if (!cv || !cropRect || cropRect.w < 2 || cropRect.h < 2) return null
    const r = cv.getBoundingClientRect()
    const scaleX = cv.width / r.width
    const scaleY = cv.height / r.height
    return {
      sx: Math.round(cropRect.x * scaleX),
      sy: Math.round(cropRect.y * scaleY),
      sw: Math.round(cropRect.w * scaleX),
      sh: Math.round(cropRect.h * scaleY),
    }
  }

  // "Applica": ritaglia l'immagine corrente (modifica la foto scelta).
  function applyCrop() {
    const reg = cropRegion()
    if (!reg) {
      cancelCrop()
      return
    }
    applyTransform((src) => cropCanvas(src, reg.sx, reg.sy, reg.sw, reg.sh))
    cancelCrop()
  }

  // "Crea nuova foto": salva il ritaglio come nuovo file, senza toccare l'originale.
  function createCropAsNew() {
    const cv = canvasRef.current
    const reg = cropRegion()
    if (!cv || !reg) {
      cancelCrop()
      return
    }
    const cropped = cropCanvas(cv, reg.sx, reg.sy, reg.sw, reg.sh)
    cropped.toBlob(
      async (blob) => {
        try {
          if (!blob) throw new Error('Encoding fallito')
          const buf = new Uint8Array(await blob.arrayBuffer())
          const newPath = await uniquePathWithSuffix(filePath, 'ritaglio')
          await writeFileBinaryAtomic(newPath, buf)
          cancelCrop()
          setSelectedFile(newPath) // apre la nuova foto
        } catch (err) {
          console.error('Errore creazione nuova foto:', err)
        }
      },
      MIME[ext] ?? 'image/png',
      0.92,
    )
  }

  // Barra spaziatrice = pan temporaneo (come negli editor grafici).
  useEffect(() => {
    if (!annotMode) return
    function down(e: KeyboardEvent) {
      if (e.code === 'Space' && !(e.target as HTMLElement)?.matches?.('input,textarea')) {
        spaceHeld.current = true
      }
    }
    function up(e: KeyboardEvent) {
      if (e.code === 'Space') spaceHeld.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [annotMode])

  // Focus esplicito sull'input testo appena compare (autoFocus non sempre scatta);
  // dipende solo dalla comparsa, non dal valore, così non ruba il focus mentre scrivi.
  const hasTextDraft = textDraft !== null
  useEffect(() => {
    if (hasTextDraft) textInputRef.current?.focus()
  }, [hasTextDraft])

  // Spessore tratto e dimensione testo proporzionali all'immagine.
  function strokeFor(t: Thickness): number {
    const d = Math.hypot(dims.w, dims.h) || 1000
    const base = d * 0.004
    return Math.max(2, Math.round(base * (t === 'S' ? 1 : t === 'M' ? 2 : 3.5)))
  }
  function fontFor(t: Thickness): number {
    const d = Math.hypot(dims.w, dims.h) || 1000
    const base = d * 0.02
    return Math.max(12, Math.round(base * (t === 'S' ? 1 : t === 'M' ? 1.6 : 2.4)))
  }

  // Coordinate del puntatore -> pixel immagine (l'SVG ha viewBox = dims native).
  function toNative(e: React.PointerEvent): { x: number; y: number } {
    const r = (e.currentTarget as Element).getBoundingClientRect()
    return {
      x: clamp(((e.clientX - r.left) / r.width) * dims.w, 0, dims.w),
      y: clamp(((e.clientY - r.top) / r.height) * dims.h, 0, dims.h),
    }
  }

  function startAnnot() {
    setDraft(null)
    setTextDraft(null)
    setShapes([])
    setAnnotMode(true) // il fit del viewport avviene nel layout effect
  }
  function cancelAnnot() {
    setAnnotMode(false)
    setShapes([])
    setDraft(null)
    setTextDraft(null)
  }
  function undoShape() {
    setShapes((s) => s.slice(0, -1))
  }

  function onAnnotDown(e: React.PointerEvent) {
    // Pan: strumento mano, barra spaziatrice o tasto centrale del mouse.
    if (tool === 'pan' || spaceHeld.current || e.button === 1) {
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      panning.current = true
      const v = viewRef.current
      panStart.current = { cx: e.clientX, cy: e.clientY, tx: v.tx, ty: v.ty }
      return
    }
    if (textDraft) return // c'è un input testo aperto: lascia gestire al blur
    const p = toNative(e)
    if (tool === 'text') {
      setTextDraft({ x: p.x, y: p.y, size: fontFor(thickness), color, value: '' })
      return
    }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    dragging.current = true
    dragStart.current = p
    let d: Shape
    if (tool === 'pen1' || tool === 'pen2') {
      const pen = penPresets[tool === 'pen1' ? 0 : 1]
      d = { type: 'pen', color: pen.color, width: pen.width, opacity: pen.opacity, points: [p] }
    } else if (tool === 'arrow') {
      d = { type: 'arrow', color, width: strokeFor(thickness), x1: p.x, y1: p.y, x2: p.x, y2: p.y }
    } else {
      // tool === 'shape'
      const w = strokeFor(thickness)
      if (shapeKind === 'line') d = { type: 'line', color, width: w, x1: p.x, y1: p.y, x2: p.x, y2: p.y }
      else if (shapeKind === 'ellipse') d = { type: 'ellipse', color, width: w, x: p.x, y: p.y, w: 0, h: 0 }
      else if (shapeKind === 'triangle') d = { type: 'triangle', color, width: w, x: p.x, y: p.y, w: 0, h: 0 }
      else d = { type: 'rect', color, width: w, x: p.x, y: p.y, w: 0, h: 0 }
    }
    draftRef.current = d
    setDraft(d)
  }
  function onAnnotMove(e: React.PointerEvent) {
    if (panning.current && panStart.current) {
      const s = panStart.current
      setView((v) => ({ ...v, tx: s.tx + (e.clientX - s.cx), ty: s.ty + (e.clientY - s.cy) }))
      return
    }
    if (!dragging.current) return
    const d = draftRef.current
    if (!d) return
    const p = toNative(e)
    let nd: Shape
    if (d.type === 'pen') nd = { ...d, points: [...d.points, p] }
    else if (d.type === 'arrow' || d.type === 'line') nd = { ...d, x2: p.x, y2: p.y }
    else if (d.type === 'rect' || d.type === 'ellipse' || d.type === 'triangle') {
      const s = dragStart.current!
      nd = { ...d, x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) }
    } else return
    draftRef.current = nd
    setDraft(nd)
  }
  function onAnnotUp() {
    if (panning.current) {
      panning.current = false
      panStart.current = null
      return
    }
    if (!dragging.current) return
    dragging.current = false
    const d = draftRef.current
    draftRef.current = null
    setDraft(null)
    if (!d) return
    // Scarta forme degeneri (linee/forme troppo piccole).
    if ((d.type === 'arrow' || d.type === 'line') && Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 3) return
    if ((d.type === 'rect' || d.type === 'ellipse' || d.type === 'triangle') && (d.w < 3 || d.h < 3)) return
    if (d.type === 'pen' && d.points.length === 0) return
    setShapes((prev) => [...prev, d])
  }

  function commitText() {
    if (cancelText.current) {
      cancelText.current = false
      setTextDraft(null)
      return
    }
    const td = textDraft
    if (td && td.value.trim()) {
      setShapes((prev) => [
        ...prev,
        { type: 'text', color: td.color, size: td.size, x: td.x, y: td.y, text: td.value },
      ])
    }
    setTextDraft(null)
  }

  // "Applica": riversa le annotazioni sull'immagine (distruttivo, come da V1).
  function applyAnnotations() {
    if (shapes.length === 0) {
      setAnnotMode(false)
      return
    }
    applyTransform((src) => {
      const c = cloneCanvas(src)
      drawShapesToCtx(c.getContext('2d')!, shapes)
      return c
    })
    cancelAnnot()
  }

  // Forma -> elemento SVG (preview live; stessa geometria del flatten su canvas).
  function shapeSvg(s: Shape, key: number | string) {
    if (s.type === 'pen') {
      if (s.points.length === 1)
        return (
          <circle
            key={key}
            cx={s.points[0].x}
            cy={s.points[0].y}
            r={s.width / 2}
            fill={s.color}
            fillOpacity={s.opacity}
          />
        )
      const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')
      return (
        <path
          key={key}
          d={d}
          fill="none"
          stroke={s.color}
          strokeWidth={s.width}
          strokeOpacity={s.opacity}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )
    }
    if (s.type === 'arrow') {
      const g = arrowGeometry(s.x1, s.y1, s.x2, s.y2, s.width)
      return (
        <g key={key}>
          <line
            x1={s.x1}
            y1={s.y1}
            x2={g.base.x}
            y2={g.base.y}
            stroke={s.color}
            strokeWidth={s.width}
            strokeLinecap="round"
          />
          <polygon
            points={`${g.tip.x},${g.tip.y} ${g.left.x},${g.left.y} ${g.right.x},${g.right.y}`}
            fill={s.color}
          />
        </g>
      )
    }
    if (s.type === 'line')
      return (
        <line
          key={key}
          x1={s.x1}
          y1={s.y1}
          x2={s.x2}
          y2={s.y2}
          stroke={s.color}
          strokeWidth={s.width}
          strokeLinecap="round"
        />
      )
    if (s.type === 'rect')
      return (
        <rect
          key={key}
          x={s.x}
          y={s.y}
          width={s.w}
          height={s.h}
          fill="none"
          stroke={s.color}
          strokeWidth={s.width}
        />
      )
    if (s.type === 'ellipse')
      return (
        <ellipse
          key={key}
          cx={s.x + s.w / 2}
          cy={s.y + s.h / 2}
          rx={s.w / 2}
          ry={s.h / 2}
          fill="none"
          stroke={s.color}
          strokeWidth={s.width}
        />
      )
    if (s.type === 'triangle')
      return (
        <polygon
          key={key}
          points={`${s.x + s.w / 2},${s.y} ${s.x},${s.y + s.h} ${s.x + s.w},${s.y + s.h}`}
          fill="none"
          stroke={s.color}
          strokeWidth={s.width}
          strokeLinejoin="round"
        />
      )
    return (
      <text
        key={key}
        x={s.x}
        y={s.y}
        fontSize={s.size}
        fill={s.color}
        fontFamily="sans-serif"
        dominantBaseline="text-before-edge"
        style={{ whiteSpace: 'pre' }}
      >
        {s.text}
      </text>
    )
  }

  // Offset del canvas dentro il contenitore, per posizionare il rettangolo di selezione.
  let ox = 0
  let oy = 0
  if (cropMode && canvasRef.current && containerRef.current) {
    const cr = canvasRef.current.getBoundingClientRect()
    const cor = containerRef.current.getBoundingClientRect()
    ox = cr.left - cor.left
    oy = cr.top - cor.top
  }

  const fileName = filePath.split('\\').pop()
  const canEdit = !loading && !error
  // Indice della penna attiva (0/1) o null se lo strumento non è una penna.
  const penIdx = tool === 'pen1' ? 0 : tool === 'pen2' ? 1 : null

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between gap-3">
        <span className="text-sm text-zinc-400 truncate flex items-center gap-2">
          {dirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
          {fileName}
          <span className="text-xs text-zinc-600">
            {dims.w}×{dims.h}
          </span>
        </span>
      </div>

      {cropMode ? (
        <div className="px-4 py-1.5 border-b border-zinc-800 flex items-center gap-2 text-xs">
          <span className="text-zinc-500">Trascina sull'immagine per selezionare l'area.</span>
          <div className="flex-1" />
          <button className={toolBtn} onClick={cancelCrop}>
            Annulla
          </button>
          <button
            onClick={createCropAsNew}
            disabled={!cropRect || cropRect.w < 2 || cropRect.h < 2}
            className={toolBtn}
          >
            Crea nuova foto
          </button>
          <button
            onClick={applyCrop}
            disabled={!cropRect || cropRect.w < 2 || cropRect.h < 2}
            className="px-3 py-1 bg-zinc-100 text-zinc-900 rounded font-medium hover:bg-white disabled:opacity-40"
            title="Modifica la foto corrente"
          >
            Applica
          </button>
        </div>
      ) : annotMode ? (
        <div className="px-4 py-1.5 border-b border-zinc-800 flex items-center gap-1.5 text-xs flex-wrap">
          {(
            [
              ['pen1', '✏︎ Penna 1'],
              ['pen2', '✏︎ Penna 2'],
              ['arrow', '↗ Freccia'],
              ['shape', '▭ Forme'],
              ['text', 'T Testo'],
              ['pan', '✋'],
            ] as [AnnotTool, string][]
          ).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTool(t)}
              title={t === 'pan' ? 'Sposta (anche con barra spazio o tasto centrale)' : undefined}
              className={tool === t ? activeChip : toolBtn}
            >
              {label}
            </button>
          ))}

          <div className="w-px h-5 bg-zinc-700 mx-1" />

          {/* Sotto-scelta della forma */}
          {tool === 'shape' &&
            (
              [
                ['rect', '▭'],
                ['ellipse', '◯'],
                ['triangle', '△'],
                ['line', '╱'],
              ] as [ShapeKind, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                title={k}
                onClick={() => setShapeKind(k)}
                className={shapeKind === k ? activeChip : toolBtn}
              >
                {label}
              </button>
            ))}
          {tool === 'shape' && <div className="w-px h-5 bg-zinc-700 mx-1" />}

          {/* Colori: per le penne è il colore della penna, altrimenti quello condiviso */}
          {ANNOT_COLORS.map((c) => {
            const current = penIdx !== null ? penPresets[penIdx].color : color
            return (
              <button
                key={c}
                title={c}
                onClick={() => (penIdx !== null ? setPenPreset(penIdx, { color: c }) : setColor(c))}
                className={`w-5 h-5 rounded-full border ${
                  current === c
                    ? 'ring-2 ring-offset-1 ring-offset-zinc-900 ring-white border-white'
                    : 'border-zinc-600'
                }`}
                style={{ backgroundColor: c }}
              />
            )
          })}

          <div className="w-px h-5 bg-zinc-700 mx-1" />

          {/* Penna: slider opacità + spessore (persistiti). Altri tool: spessore S/M/L */}
          {penIdx !== null ? (
            <>
              <label className="flex items-center gap-1 text-zinc-400">
                Opacità
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={Math.round(penPresets[penIdx].opacity * 100)}
                  onChange={(e) => setPenPreset(penIdx, { opacity: +e.target.value / 100 })}
                  className="w-20"
                />
                <span className="w-9 text-right text-zinc-500">
                  {Math.round(penPresets[penIdx].opacity * 100)}%
                </span>
              </label>
              <label className="flex items-center gap-1 text-zinc-400">
                Spessore
                <input
                  type="range"
                  min={1}
                  max={60}
                  value={penPresets[penIdx].width}
                  onChange={(e) => setPenPreset(penIdx, { width: +e.target.value })}
                  className="w-20"
                />
                <span className="w-6 text-right text-zinc-500">{penPresets[penIdx].width}</span>
              </label>
            </>
          ) : (
            (['S', 'M', 'L'] as Thickness[]).map((t) => (
              <button
                key={t}
                onClick={() => setThickness(t)}
                className={thickness === t ? activeChip : toolBtn}
              >
                {t}
              </button>
            ))
          )}

          <div className="flex-1" />

          {/* Zoom: rotella verso il cursore, oppure questi controlli */}
          <button className={toolBtn} title="Riduci" onClick={() => zoomBy(1 / 1.25)}>
            −
          </button>
          <span className="w-10 text-center text-zinc-500">{Math.round(view.scale * 100)}%</span>
          <button className={toolBtn} title="Ingrandisci" onClick={() => zoomBy(1.25)}>
            +
          </button>
          <button className={toolBtn} onClick={() => fitView()}>
            Adatta
          </button>

          <div className="w-px h-5 bg-zinc-700 mx-1" />

          <button className={toolBtn} onClick={undoShape} disabled={shapes.length === 0}>
            Annulla ultima
          </button>
          <button className={toolBtn} onClick={cancelAnnot}>
            Annulla
          </button>
          <button
            onClick={applyAnnotations}
            disabled={shapes.length === 0}
            className="px-3 py-1 bg-zinc-100 text-zinc-900 rounded font-medium hover:bg-white disabled:opacity-40"
            title="Applica le annotazioni alla foto"
          >
            Applica
          </button>
        </div>
      ) : (
        <div className="px-4 py-1.5 border-b border-zinc-800 flex items-center gap-1 text-xs flex-wrap">
          <button className={toolBtn} title="Ruota a sinistra" disabled={!canEdit} onClick={() => applyTransform((c) => rotate90(c, -1))}>
            ⟲
          </button>
          <button className={toolBtn} title="Ruota a destra" disabled={!canEdit} onClick={() => applyTransform((c) => rotate90(c, 1))}>
            ⟳
          </button>
          <button className={toolBtn} title="Capovolgi orizzontale" disabled={!canEdit} onClick={() => applyTransform((c) => flip(c, 'h'))}>
            ⇋
          </button>
          <button className={toolBtn} title="Capovolgi verticale" disabled={!canEdit} onClick={() => applyTransform((c) => flip(c, 'v'))}>
            ⇅
          </button>
          <button className={toolBtn} disabled={!canEdit} onClick={startCrop}>
            Ritaglia
          </button>
          <button className={toolBtn} disabled={!canEdit} onClick={() => setResizeOpen(true)}>
            Ridimensiona
          </button>
          <button className={toolBtn} disabled={!canEdit} onClick={startAnnot}>
            Annota
          </button>

          <div className="flex-1" />

          <button className={toolBtn} title="Riduci" onClick={() => zoomBy(1 / 1.25)}>
            −
          </button>
          <span className="w-10 text-center text-zinc-500">{Math.round(view.scale * 100)}%</span>
          <button className={toolBtn} title="Ingrandisci" onClick={() => zoomBy(1.25)}>
            +
          </button>
          <button className={toolBtn} onClick={() => fitView()}>
            Adatta
          </button>

          <div className="w-px h-5 bg-zinc-700 mx-1" />

          <button
            className={toolBtn}
            disabled={!dirty || saving}
            onClick={() => {
              clearImageBuffer(filePath)
              setReloadNonce((n) => n + 1)
            }}
          >
            Annulla
          </button>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="px-3 py-1 bg-zinc-100 text-zinc-900 rounded font-medium hover:bg-white disabled:opacity-40"
          >
            {saving ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        className={`flex-1 overflow-hidden bg-zinc-950 relative select-none ${
          !annotMode && !cropMode ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
        // In modalità normale (no annota, no crop) il trascinamento sposta la vista.
        onPointerDown={!annotMode && !cropMode ? onViewDown : undefined}
        onPointerMove={!annotMode && !cropMode ? onViewMove : undefined}
        onPointerUp={!annotMode && !cropMode ? onViewUp : undefined}
      >
        {error && (
          <span className="absolute inset-0 flex items-center justify-center text-zinc-500 text-sm">
            Impossibile caricare l'immagine.
          </span>
        )}
        {loading && !error && (
          <span className="absolute inset-0 flex items-center justify-center text-zinc-500 text-sm">
            Caricamento…
          </span>
        )}

        {/* Palco: canvas + overlay traslati/scalati insieme dal viewport. */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transformOrigin: '0 0',
            transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
          }}
        >
          <canvas ref={canvasRef} className="block" />
          {annotMode && (
            <svg
              className={
                tool === 'pan' ? 'absolute cursor-grab' : tool === 'text' ? 'absolute cursor-text' : 'absolute cursor-crosshair'
              }
              style={{ left: 0, top: 0, touchAction: 'none' }}
              width={dims.w}
              height={dims.h}
              viewBox={`0 0 ${dims.w} ${dims.h}`}
              preserveAspectRatio="none"
              // Evita che il browser sposti il focus al body al mousedown (e la
              // selezione testo): altrimenti l'input testo perde subito il focus.
              onMouseDown={(e) => e.preventDefault()}
              onPointerDown={onAnnotDown}
              onPointerMove={onAnnotMove}
              onPointerUp={onAnnotUp}
            >
              {shapes.map((s, i) => shapeSvg(s, i))}
              {draft && shapeSvg(draft, 'draft')}
            </svg>
          )}
        </div>

        {!annotMode && cropMode && (
          <div
            className="absolute inset-0 cursor-crosshair"
            onMouseDown={onCropDown}
            onMouseMove={onCropMove}
            onMouseUp={onCropUp}
            onMouseLeave={onCropUp}
          />
        )}
        {!annotMode && cropMode && cropRect && (
          <div
            className="absolute border border-white pointer-events-none"
            style={{
              left: ox + cropRect.x,
              top: oy + cropRect.y,
              width: cropRect.w,
              height: cropRect.h,
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
            }}
          />
        )}

        {annotMode && textDraft && (
          <input
            ref={textInputRef}
            autoFocus
            placeholder="Testo…"
            value={textDraft.value}
            onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              } else if (e.key === 'Escape') {
                cancelText.current = true
                e.currentTarget.blur()
              }
            }}
            onBlur={commitText}
            className="absolute outline-none border border-dashed border-white/70 leading-none"
            style={{
              left: view.tx + textDraft.x * view.scale,
              top: view.ty + textDraft.y * view.scale,
              color: textDraft.color,
              fontSize: textDraft.size * view.scale,
              fontFamily: 'sans-serif',
              background: 'rgba(0,0,0,0.45)',
              padding: '1px 2px',
              minWidth: '3ch',
            }}
          />
        )}
      </div>

      {resizeOpen && (
        <ResizeModal
          width={dims.w}
          height={dims.h}
          onCancel={() => setResizeOpen(false)}
          onApply={(w, h) => {
            applyTransform((c) => resizeCanvas(c, w, h))
            setResizeOpen(false)
          }}
        />
      )}
    </div>
  )
}

function ResizeModal({
  width,
  height,
  onApply,
  onCancel,
}: {
  width: number
  height: number
  onApply: (w: number, h: number) => void
  onCancel: () => void
}) {
  const ratio = width / height || 1
  const [w, setW] = useState(width)
  const [h, setH] = useState(height)
  const [lock, setLock] = useState(true)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div
        className="w-72 bg-zinc-900 border border-zinc-700 rounded-lg p-4 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-zinc-200">Ridimensiona</h3>
        <label className="text-xs text-zinc-400 flex items-center justify-between gap-2">
          Larghezza
          <input
            type="number"
            value={w}
            min={1}
            onChange={(e) => {
              const nv = Math.max(1, Math.round(+e.target.value))
              setW(nv)
              if (lock) setH(Math.max(1, Math.round(nv / ratio)))
            }}
            className="w-28 px-2 py-1 bg-zinc-950 border border-zinc-700 rounded text-zinc-100 focus:outline-none focus:border-zinc-500"
          />
        </label>
        <label className="text-xs text-zinc-400 flex items-center justify-between gap-2">
          Altezza
          <input
            type="number"
            value={h}
            min={1}
            onChange={(e) => {
              const nv = Math.max(1, Math.round(+e.target.value))
              setH(nv)
              if (lock) setW(Math.max(1, Math.round(nv * ratio)))
            }}
            className="w-28 px-2 py-1 bg-zinc-950 border border-zinc-700 rounded text-zinc-100 focus:outline-none focus:border-zinc-500"
          />
        </label>
        <label className="text-xs text-zinc-400 flex items-center gap-2">
          <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
          Mantieni proporzioni
        </label>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 rounded">
            Annulla
          </button>
          <button
            onClick={() => onApply(w, h)}
            className="px-3 py-1.5 text-xs bg-zinc-100 text-zinc-900 rounded font-medium hover:bg-white"
          >
            Applica
          </button>
        </div>
      </div>
    </div>
  )
}

function ViewOnlyImage({ filePath }: { filePath: string }) {
  const ext = extOf(filePath)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [dims, setDims] = useState({ w: 0, h: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const { view, fitView, zoomBy, onViewDown, onViewMove, onViewUp } = useImageViewport(
    containerRef,
    dims,
    true,
  )

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setError(false)
    setUrl(null)
    setDims({ w: 0, h: 0 })
    readFile(filePath)
      .then((bytes) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: MIME[ext] ?? 'application/octet-stream' }))
        setUrl(objectUrl)
      })
      .catch((err) => {
        console.error('Errore lettura immagine:', err)
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [filePath, ext])

  const fileName = filePath.split('\\').pop()

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between gap-3">
        <span className="text-sm text-zinc-400 truncate">{fileName}</span>
        <div className="flex items-center gap-1 text-xs text-zinc-300">
          <button className={toolBtn} title="Riduci" onClick={() => zoomBy(1 / 1.25)}>
            −
          </button>
          <span className="w-10 text-center text-zinc-500">{Math.round(view.scale * 100)}%</span>
          <button className={toolBtn} title="Ingrandisci" onClick={() => zoomBy(1.25)}>
            +
          </button>
          <button className={toolBtn} onClick={() => fitView()}>
            Adatta
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-hidden bg-zinc-950 relative select-none cursor-grab active:cursor-grabbing"
        onPointerDown={onViewDown}
        onPointerMove={onViewMove}
        onPointerUp={onViewUp}
      >
        {error && (
          <span className="absolute inset-0 flex items-center justify-center text-zinc-500 text-sm">
            Impossibile caricare l'immagine.
          </span>
        )}
        {!error && !url && (
          <span className="absolute inset-0 flex items-center justify-center text-zinc-500 text-sm">
            Caricamento…
          </span>
        )}
        {url && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              transformOrigin: '0 0',
              transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
            }}
          >
            <img
              src={url}
              alt={fileName}
              draggable={false}
              width={dims.w || undefined}
              height={dims.h || undefined}
              className="block max-w-none"
              onLoad={(e) =>
                setDims({
                  w: e.currentTarget.naturalWidth || 300,
                  h: e.currentTarget.naturalHeight || 300,
                })
              }
            />
          </div>
        )}
      </div>
    </div>
  )
}
