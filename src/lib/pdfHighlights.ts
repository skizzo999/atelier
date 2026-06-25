import { PDFDocument, PDFName, PDFString, PDFDict, PDFRef } from 'pdf-lib'

// Un'evidenziazione: una o più strisce (righe) su una pagina, in coordinate a
// scala 1 (punti PDF, origine in alto a sinistra, y verso il basso).
export interface Highlight {
  id: string
  page: number // 1-based
  color: string // hex #rrggbb
  rects: { x0: number; y0: number; x1: number; y1: number }[]
}

// Tag con cui marchiamo LE NOSTRE annotazioni, per poterle togliere/riscrivere
// senza toccare eventuali annotazioni di altri programmi.
const TAG = 'atelier-hl'
const META_KEY = 'AtelierHighlights'

function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [1, 0.85, 0]
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function annotIsMine(context: PDFDocument['context'], el: unknown): boolean {
  const dict = el instanceof PDFRef ? context.lookup(el) : el
  if (!(dict instanceof PDFDict)) return false
  const t = dict.get(PDFName.of('T'))
  return t instanceof PDFString && t.decodeText() === TAG
}

// Apre il PDF, legge le NOSTRE evidenziazioni (dal JSON che scriviamo noi) e
// restituisce una "base" ripulita dalle nostre annotazioni/metadati: ogni
// salvataggio riparte da lì, così non si accumulano duplicati.
export async function prepareHighlights(bytes: Uint8Array): Promise<{ highlights: Highlight[]; base: Uint8Array }> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  let highlights: Highlight[] = []
  let dirty = false

  const meta = doc.catalog.get(PDFName.of(META_KEY))
  if (meta instanceof PDFString) {
    try {
      highlights = JSON.parse(meta.decodeText()) as Highlight[]
    } catch {
      /* metadato corrotto: ignora */
    }
    doc.catalog.delete(PDFName.of(META_KEY))
    dirty = true
  }

  for (const page of doc.getPages()) {
    const annots = page.node.Annots()
    if (!annots) continue
    const all = annots.asArray()
    const keep = all.filter((el) => !annotIsMine(doc.context, el))
    if (keep.length !== all.length) {
      page.node.set(PDFName.of('Annots'), doc.context.obj(keep))
      dirty = true
    }
  }

  const base = dirty ? await doc.save({ useObjectStreams: false }) : bytes
  return { highlights, base }
}

// Scrive le evidenziazioni nella "base": annotazioni /Highlight standard (visibili
// in ogni lettore) + un JSON nel catalog per ricaricarle con coordinate esatte.
export async function writeHighlights(base: Uint8Array, highlights: Highlight[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(base, { ignoreEncryption: true, updateMetadata: false })
  const pages = doc.getPages()

  for (const hl of highlights) {
    const page = pages[hl.page - 1]
    if (!page || !hl.rects.length) continue
    const H = page.getHeight()
    const quad: number[] = []
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const r of hl.rects) {
      const left = r.x0
      const right = r.x1
      const top = H - r.y0
      const bottom = H - r.y1
      // QuadPoints: UL, UR, LL, LR (x,y) per striscia.
      quad.push(left, top, right, top, left, bottom, right, bottom)
      minX = Math.min(minX, left)
      maxX = Math.max(maxX, right)
      minY = Math.min(minY, bottom)
      maxY = Math.max(maxY, top)
    }
    const [cr, cg, cb] = hexToRgb01(hl.color)
    const annot = doc.context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Highlight'),
      Rect: [minX, minY, maxX, maxY],
      QuadPoints: quad,
      C: [cr, cg, cb],
      CA: 0.4,
      F: 4, // Print
      T: PDFString.of(TAG),
    })
    const ref = doc.context.register(annot)
    let annots = page.node.Annots()
    if (!annots) {
      annots = doc.context.obj([])
      page.node.set(PDFName.of('Annots'), annots)
    }
    annots.push(ref)
  }

  doc.catalog.set(PDFName.of(META_KEY), PDFString.of(JSON.stringify(highlights)))
  const out = await doc.save({ useObjectStreams: false })
  // Sicurezza: non restituire (e quindi non sovrascrivere il file) se l'output
  // non è un PDF rileggibile. Meglio non salvare che corrompere il PDF.
  await PDFDocument.load(out, { ignoreEncryption: true, updateMetadata: false })
  return out
}
