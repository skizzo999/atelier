// Annotazioni immagine: tipi delle forme e disegno su canvas 2D.
// Le coordinate sono sempre in pixel dell'immagine (spazio "nativo"), così la
// preview SVG (con viewBox = dimensioni native) e il flatten su canvas coincidono.

export type AnnotTool = 'pen1' | 'pen2' | 'arrow' | 'shape' | 'text' | 'pan'
export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'line'

export interface Point {
  x: number
  y: number
}

export type Shape =
  | { type: 'pen'; color: string; width: number; opacity: number; points: Point[] }
  | { type: 'arrow'; color: string; width: number; x1: number; y1: number; x2: number; y2: number }
  | { type: 'line'; color: string; width: number; x1: number; y1: number; x2: number; y2: number }
  | { type: 'rect'; color: string; width: number; x: number; y: number; w: number; h: number }
  | { type: 'ellipse'; color: string; width: number; x: number; y: number; w: number; h: number }
  | { type: 'triangle'; color: string; width: number; x: number; y: number; w: number; h: number }
  | { type: 'text'; color: string; size: number; x: number; y: number; text: string }

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
  if (s.type === 'pen') {
    ctx.globalAlpha = s.opacity
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
    const g = arrowGeometry(s.x1, s.y1, s.x2, s.y2, s.width)
    ctx.strokeStyle = s.color
    ctx.fillStyle = s.color
    ctx.lineWidth = s.width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    // Gambo fino alla base della testa (non oltre, niente "blob" sulla punta).
    ctx.beginPath()
    ctx.moveTo(s.x1, s.y1)
    ctx.lineTo(g.base.x, g.base.y)
    ctx.stroke()
    // Triangolo della punta.
    ctx.beginPath()
    ctx.moveTo(g.tip.x, g.tip.y)
    ctx.lineTo(g.left.x, g.left.y)
    ctx.lineTo(g.right.x, g.right.y)
    ctx.closePath()
    ctx.fill()
  } else if (s.type === 'line') {
    ctx.strokeStyle = s.color
    ctx.lineWidth = s.width
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(s.x1, s.y1)
    ctx.lineTo(s.x2, s.y2)
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
    ctx.moveTo(s.x + s.w / 2, s.y) // vertice in alto
    ctx.lineTo(s.x, s.y + s.h) // basso sinistra
    ctx.lineTo(s.x + s.w, s.y + s.h) // basso destra
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
