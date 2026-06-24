// Annotazioni immagine: tipi delle forme e disegno su canvas 2D.
// Le coordinate sono sempre in pixel dell'immagine (spazio "nativo"), così la
// preview SVG (con viewBox = dimensioni native) e il flatten su canvas coincidono.

export type AnnotTool = 'pen1' | 'pen2' | 'arrow' | 'shape' | 'text' | 'pan' | 'select'
export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'line'

export interface Point {
  x: number
  y: number
}

// Campi comuni a ogni forma (id selezione, opacità, rotazione in radianti).
export interface ShapeBase {
  id: string
  opacity: number
  rot: number
}

export type Shape = ShapeBase &
  (
    | { type: 'pen'; color: string; width: number; points: Point[] }
    // Freccia/linea: p1 -> p2 con un punto di controllo centrale (mid sta SULLA
    // curva quadratica; la si tira per curvare il tratto).
    | { type: 'arrow'; color: string; width: number; p1: Point; mid: Point; p2: Point }
    | { type: 'line'; color: string; width: number; p1: Point; mid: Point; p2: Point }
    | { type: 'rect'; color: string; width: number; x: number; y: number; w: number; h: number }
    | { type: 'ellipse'; color: string; width: number; x: number; y: number; w: number; h: number }
    | { type: 'triangle'; color: string; width: number; p1: Point; p2: Point; p3: Point }
    | { type: 'text'; color: string; size: number; x: number; y: number; text: string }
  )

export interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

let idCounter = 0
export function newId(): string {
  return `s${Date.now().toString(36)}${(idCounter++).toString(36)}`
}

// Misura della larghezza testo (canvas condiviso, font come nel rendering).
let measureCtx: CanvasRenderingContext2D | null = null
function textMetrics(text: string, size: number): { w: number; h: number } {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  measureCtx!.font = `${size}px sans-serif`
  return { w: Math.max(measureCtx!.measureText(text || ' ').width, 4), h: size }
}

function bboxOfPoints(pts: Point[]): Bounds {
  if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 }
  let minx = Infinity,
    miny = Infinity,
    maxx = -Infinity,
    maxy = -Infinity
  for (const p of pts) {
    minx = Math.min(minx, p.x)
    miny = Math.min(miny, p.y)
    maxx = Math.max(maxx, p.x)
    maxy = Math.max(maxy, p.y)
  }
  return { x: minx, y: miny, w: maxx - minx, h: maxy - miny }
}

// Punto di controllo della bezier quadratica tale che la curva passa per `mid`
// a metà (così la maniglia centrale resta SUL tratto).
export function quadControl(p1: Point, mid: Point, p2: Point): Point {
  return { x: 2 * mid.x - (p1.x + p2.x) / 2, y: 2 * mid.y - (p1.y + p2.y) / 2 }
}
function quadAt(p0: Point, c: Point, p2: Point, t: number): Point {
  const u = 1 - t
  return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y }
}
function unit(x: number, y: number): Point {
  const l = Math.hypot(x, y) || 1
  return { x: x / l, y: y / l }
}

// Parti di una freccia curva: gambo (bezier accorciato prima della testa) +
// triangolo della punta orientato sulla tangente finale, così resta appuntita.
export interface ArrowParts {
  p1: Point
  q0: Point // controllo del gambo accorciato
  end: Point // fine del gambo (base della testa)
  head: [Point, Point, Point] // punta + due angoli base
}
export function arrowParts(p1: Point, mid: Point, p2: Point, width: number): ArrowParts {
  const c = quadControl(p1, mid, p2)
  const dir = unit(p2.x - c.x, p2.y - c.y)
  const headLen = Math.max(width * 3.5, 16)
  const headW = Math.max(width * 3, 13)
  const base = { x: p2.x - dir.x * headLen, y: p2.y - dir.y * headLen }
  // t lungo la bezier più vicino alla base della testa (per accorciare il gambo).
  let bt = 1
  let bd = Infinity
  for (let i = 0; i <= 48; i++) {
    const t = i / 48
    const q = quadAt(p1, c, p2, t)
    const d = Math.hypot(q.x - base.x, q.y - base.y)
    if (d < bd) {
      bd = d
      bt = t
    }
  }
  const perp = { x: -dir.y, y: dir.x }
  return {
    p1,
    q0: { x: p1.x + (c.x - p1.x) * bt, y: p1.y + (c.y - p1.y) * bt },
    end: quadAt(p1, c, p2, bt),
    head: [
      { x: p2.x, y: p2.y },
      { x: base.x + (perp.x * headW) / 2, y: base.y + (perp.y * headW) / 2 },
      { x: base.x - (perp.x * headW) / 2, y: base.y - (perp.y * headW) / 2 },
    ],
  }
}

// Bounding box (axis-aligned) di una forma, in pixel immagine.
export function boundsOf(s: Shape): Bounds {
  switch (s.type) {
    case 'pen':
      return bboxOfPoints(s.points)
    case 'arrow':
    case 'line':
      return bboxOfPoints([s.p1, s.mid, s.p2])
    case 'triangle':
      return bboxOfPoints([s.p1, s.p2, s.p3])
    case 'text': {
      const m = textMetrics(s.text, s.size)
      return { x: s.x, y: s.y, w: m.w, h: m.h }
    }
    default:
      return { x: s.x, y: s.y, w: s.w, h: s.h } // rect/ellipse
  }
}

// Centro del bounding box (pivot di rotazione).
export function centerOf(s: Shape): Point {
  const b = boundsOf(s)
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 }
}

// Punti di controllo trascinabili (warp). Vuoto per pen/text/rect/ellisse (box di resize).
export function controlPoints(s: Shape): Point[] {
  switch (s.type) {
    case 'arrow':
    case 'line':
      return [s.p1, s.mid, s.p2] // estremi + punto centrale (curva)
    case 'triangle':
      return [s.p1, s.p2, s.p3]
    default:
      return []
  }
}

// Sposta il punto di controllo i alla posizione p (deforma il tratto).
export function moveControl(s: Shape, i: number, p: Point): Shape {
  switch (s.type) {
    case 'arrow':
    case 'line':
      return i === 0 ? { ...s, p1: p } : i === 1 ? { ...s, mid: p } : { ...s, p2: p }
    case 'triangle':
      return i === 0 ? { ...s, p1: p } : i === 1 ? { ...s, p2: p } : { ...s, p3: p }
    default:
      return s
  }
}

// Sposta tutta la geometria di (dx,dy).
export function translateShape(s: Shape, dx: number, dy: number): Shape {
  const mv = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy })
  switch (s.type) {
    case 'pen':
      return { ...s, points: s.points.map(mv) }
    case 'arrow':
    case 'line':
      return { ...s, p1: mv(s.p1), mid: mv(s.mid), p2: mv(s.p2) }
    case 'triangle':
      return { ...s, p1: mv(s.p1), p2: mv(s.p2), p3: mv(s.p3) }
    default:
      return { ...s, x: s.x + dx, y: s.y + dy } // rect/ellipse/text
  }
}

// Scala la geometria attorno all'ancora (ax,ay) di fattori (sx,sy).
export function scaleShape(s: Shape, ax: number, ay: number, sx: number, sy: number): Shape {
  const sp = (p: Point): Point => ({ x: ax + (p.x - ax) * sx, y: ay + (p.y - ay) * sy })
  switch (s.type) {
    case 'pen':
      return { ...s, points: s.points.map(sp) }
    case 'arrow':
    case 'line':
      return { ...s, p1: sp(s.p1), mid: sp(s.mid), p2: sp(s.p2) }
    case 'triangle':
      return { ...s, p1: sp(s.p1), p2: sp(s.p2), p3: sp(s.p3) }
    case 'text': {
      const a = sp({ x: s.x, y: s.y })
      return { ...s, x: a.x, y: a.y, size: Math.max(6, s.size * sy) }
    }
    default: {
      const a = sp({ x: s.x, y: s.y }) // rect/ellipse
      return { ...s, x: a.x, y: a.y, w: s.w * sx, h: s.h * sy }
    }
  }
}

// Geometria di una freccia: gambo (start -> base della testa) + triangolo della
// punta nettamente più largo del gambo, così la punta si legge bene.
export interface ArrowGeometry {
  base: Point // centro della base della testa (dove finisce il gambo)
  tip: Point // punta
  left: Point // angolo sinistro della base
  right: Point // angolo destro della base
}

export function arrowGeometry(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
): ArrowGeometry {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const headLen = Math.max(width * 3.5, 16)
  const headW = Math.max(width * 3, 13)
  const base = { x: x2 - headLen * Math.cos(angle), y: y2 - headLen * Math.sin(angle) }
  const px = Math.cos(angle + Math.PI / 2)
  const py = Math.sin(angle + Math.PI / 2)
  return {
    base,
    tip: { x: x2, y: y2 },
    left: { x: base.x + (px * headW) / 2, y: base.y + (py * headW) / 2 },
    right: { x: base.x - (px * headW) / 2, y: base.y - (py * headW) / 2 },
  }
}

// Disegna una singola forma sul contesto (coordinate native).
export function drawShapeToCtx(ctx: CanvasRenderingContext2D, s: Shape): void {
  ctx.save()
  ctx.globalAlpha = s.opacity
  if (s.rot) {
    const c = centerOf(s)
    ctx.translate(c.x, c.y)
    ctx.rotate(s.rot)
    ctx.translate(-c.x, -c.y)
  }
  if (s.type === 'pen') {
    ctx.strokeStyle = s.color
    ctx.fillStyle = s.color
    ctx.lineWidth = s.width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (s.points.length === 1) {
      // Un singolo click lascia un punto.
      ctx.beginPath()
      ctx.arc(s.points[0].x, s.points[0].y, s.width / 2, 0, Math.PI * 2)
      ctx.fill()
    } else if (s.points.length > 1) {
      ctx.beginPath()
      ctx.moveTo(s.points[0].x, s.points[0].y)
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y)
      ctx.stroke()
    }
  } else if (s.type === 'arrow') {
    // Gambo curvo accorciato + punta appuntita orientata sulla tangente finale.
    const a = arrowParts(s.p1, s.mid, s.p2, s.width)
    ctx.strokeStyle = s.color
    ctx.fillStyle = s.color
    ctx.lineWidth = s.width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(a.p1.x, a.p1.y)
    ctx.quadraticCurveTo(a.q0.x, a.q0.y, a.end.x, a.end.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(a.head[0].x, a.head[0].y)
    ctx.lineTo(a.head[1].x, a.head[1].y)
    ctx.lineTo(a.head[2].x, a.head[2].y)
    ctx.closePath()
    ctx.fill()
  } else if (s.type === 'line') {
    const c = quadControl(s.p1, s.mid, s.p2)
    ctx.strokeStyle = s.color
    ctx.lineWidth = s.width
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(s.p1.x, s.p1.y)
    ctx.quadraticCurveTo(c.x, c.y, s.p2.x, s.p2.y)
    ctx.stroke()
  } else if (s.type === 'rect') {
    ctx.strokeStyle = s.color
    ctx.lineWidth = s.width
    ctx.lineJoin = 'miter'
    ctx.strokeRect(s.x, s.y, s.w, s.h)
  } else if (s.type === 'ellipse') {
    ctx.strokeStyle = s.color
    ctx.lineWidth = s.width
    ctx.beginPath()
    ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.abs(s.w) / 2, Math.abs(s.h) / 2, 0, 0, Math.PI * 2)
    ctx.stroke()
  } else if (s.type === 'triangle') {
    ctx.strokeStyle = s.color
    ctx.lineWidth = s.width
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(s.p1.x, s.p1.y)
    ctx.lineTo(s.p2.x, s.p2.y)
    ctx.lineTo(s.p3.x, s.p3.y)
    ctx.closePath()
    ctx.stroke()
  } else if (s.type === 'text') {
    ctx.fillStyle = s.color
    ctx.textBaseline = 'top'
    ctx.font = `${s.size}px sans-serif`
    ctx.fillText(s.text, s.x, s.y)
  }
  ctx.restore()
}

export function drawShapesToCtx(ctx: CanvasRenderingContext2D, shapes: Shape[]): void {
  for (const s of shapes) drawShapeToCtx(ctx, s)
}
