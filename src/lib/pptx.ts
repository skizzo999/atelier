import { unzipSync, strFromU8 } from 'fflate'

// Parser PPTX best-effort (Fase 3 del piano Office): un .pptx è uno ZIP di XML
// (come il docx). Estraiamo per ogni slide: sfondo, forme con posizione/
// dimensione (EMU → px), testo con stili base (dimensione/grassetto/corsivo/
// colore/allineamento/bullet) e immagini. Le forme senza posizione propria la
// EREDITANO dal placeholder del layout (un livello: slide → slideLayout).
// Fuori dal v1: gruppi con trasformazioni, gradienti, tabelle, grafici, master.

export interface PptxRun {
  text: string
  b?: boolean
  i?: boolean
  sz?: number // px
  color?: string
}

export interface PptxPara {
  align?: 'left' | 'center' | 'right'
  bullet?: boolean
  runs: PptxRun[]
}

export interface PptxShape {
  x: number
  y: number
  w: number
  h: number
  fill?: string
  paras?: PptxPara[]
  img?: { bytes: Uint8Array; ext: string }
}

export interface PptxSlide {
  bg?: string
  shapes: PptxShape[]
}

export interface PptxDoc {
  w: number // px a scala 1
  h: number
  slides: PptxSlide[]
}

const EMU_PER_PX = 9525
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

// Attributo r:xxx robusto: nome qualificato (browser) o namespace (altri DOM).
function rAttr(el: Element, local: string): string | null {
  return el.getAttribute(`r:${local}`) ?? el.getAttributeNS(R_NS, local)
}

function parseXml(s: string): Document | null {
  try {
    const doc = new DOMParser().parseFromString(s, 'application/xml')
    return doc.getElementsByTagName('parsererror').length ? null : doc
  } catch {
    return null
  }
}

// getElementsByTagName con nome qualificato (i pptx usano sempre i prefissi p:/a:).
function els(root: Element | Document, qname: string): Element[] {
  return Array.from(root.getElementsByTagName(qname))
}
function first(root: Element | Document, qname: string): Element | null {
  const l = root.getElementsByTagName(qname)
  return l.length ? l[0] : null
}

// Palette del tema pptx (clrScheme di theme1.xml), per nome (dk1, accent1…).
function themePalette(themeXml: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!themeXml) return out
  for (const name of ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']) {
    const m = new RegExp(`<a:${name}>[\\s\\S]{0,200}?(?:val|lastClr)="([0-9A-Fa-f]{6})"`).exec(themeXml)
    if (m) out[name] = `#${m[1].toLowerCase()}`
  }
  // alias usati dagli schemeClr
  out.tx1 = out.dk1
  out.bg1 = out.lt1
  out.tx2 = out.dk2
  out.bg2 = out.lt2
  return out
}

// Colore da un elemento che contiene srgbClr o schemeClr.
function colorOf(el: Element | null, palette: Record<string, string>): string | undefined {
  if (!el) return undefined
  const srgb = first(el, 'a:srgbClr')
  if (srgb) {
    const v = srgb.getAttribute('val')
    if (v) return `#${v.toLowerCase()}`
  }
  const scheme = first(el, 'a:schemeClr')
  if (scheme) {
    const v = scheme.getAttribute('val')
    if (v && palette[v]) return palette[v]
  }
  return undefined
}

// xfrm → box in px. null se assente (poi si tenta il layout).
function boxOf(el: Element | null): { x: number; y: number; w: number; h: number } | null {
  if (!el) return null
  const xfrm = first(el, 'a:xfrm')
  if (!xfrm) return null
  const off = first(xfrm, 'a:off')
  const ext = first(xfrm, 'a:ext')
  if (!off || !ext) return null
  const n = (e: Element, a: string) => Number(e.getAttribute(a) || 0)
  return {
    x: n(off, 'x') / EMU_PER_PX,
    y: n(off, 'y') / EMU_PER_PX,
    w: n(ext, 'cx') / EMU_PER_PX,
    h: n(ext, 'cy') / EMU_PER_PX,
  }
}

// Testo di una forma: paragrafi con run stilati.
function parasOf(sp: Element, palette: Record<string, string>): PptxPara[] | undefined {
  const body = first(sp, 'p:txBody')
  if (!body) return undefined
  const out: PptxPara[] = []
  for (const p of els(body, 'a:p')) {
    const para: PptxPara = { runs: [] }
    const pPr = first(p, 'a:pPr')
    if (pPr) {
      const algn = pPr.getAttribute('algn')
      if (algn === 'ctr') para.align = 'center'
      else if (algn === 'r') para.align = 'right'
      if (first(pPr, 'a:buChar') || first(pPr, 'a:buAutoNum')) para.bullet = true
    }
    for (const r of els(p, 'a:r')) {
      const t = first(r, 'a:t')?.textContent ?? ''
      if (!t) continue
      const rPr = first(r, 'a:rPr')
      const run: PptxRun = { text: t }
      if (rPr) {
        if (rPr.getAttribute('b') === '1') run.b = true
        if (rPr.getAttribute('i') === '1') run.i = true
        const sz = rPr.getAttribute('sz')
        if (sz) run.sz = Math.round((Number(sz) / 100) * (4 / 3)) // 1/100 pt → px
        const fill = first(rPr, 'a:solidFill')
        const col = colorOf(fill, palette)
        if (col) run.color = col
      }
      para.runs.push(run)
    }
    if (para.runs.length) out.push(para)
  }
  return out.length ? out : undefined
}

// Mappa dei placeholder di un layout: "type:idx" → box (per l'ereditarietà).
function layoutPlaceholders(layoutDoc: Document): Map<string, { x: number; y: number; w: number; h: number }> {
  const map = new Map<string, { x: number; y: number; w: number; h: number }>()
  for (const sp of els(layoutDoc, 'p:sp')) {
    const ph = first(sp, 'p:ph')
    if (!ph) continue
    const box = boxOf(first(sp, 'p:spPr'))
    if (!box) continue
    const key = `${ph.getAttribute('type') ?? 'body'}:${ph.getAttribute('idx') ?? ''}`
    map.set(key, box)
  }
  return map
}

// Rels di una parte: rId → target (path relativo alla cartella della parte).
function relsOf(files: Record<string, Uint8Array>, partPath: string): Map<string, string> {
  const map = new Map<string, string>()
  const dir = partPath.slice(0, partPath.lastIndexOf('/'))
  const name = partPath.slice(partPath.lastIndexOf('/') + 1)
  const relsBytes = files[`${dir}/_rels/${name}.rels`]
  if (!relsBytes) return map
  const doc = parseXml(strFromU8(relsBytes))
  if (!doc) return map
  for (const rel of Array.from(doc.getElementsByTagName('Relationship'))) {
    const id = rel.getAttribute('Id')
    let target = rel.getAttribute('Target')
    if (!id || !target) continue
    // normalizza ../media/x.png rispetto alla cartella della parte
    if (target.startsWith('../')) target = `ppt/${target.slice(3)}`
    else if (!target.startsWith('ppt/') && !target.startsWith('/')) target = `${dir}/${target}`
    map.set(id, target.replace(/^\//, ''))
  }
  return map
}

export function parsePptx(bytes: Uint8Array): PptxDoc {
  const files = unzipSync(bytes)

  const presBytes = files['ppt/presentation.xml']
  if (!presBytes) throw new Error('presentation.xml mancante: non è un pptx valido')
  const pres = parseXml(strFromU8(presBytes))
  if (!pres) throw new Error('presentation.xml non leggibile')

  // Dimensione slide (default 16:9).
  const sldSz = first(pres, 'p:sldSz')
  const w = sldSz ? Number(sldSz.getAttribute('cx')) / EMU_PER_PX : 1280
  const h = sldSz ? Number(sldSz.getAttribute('cy')) / EMU_PER_PX : 720

  const palette = themePalette(files['ppt/theme/theme1.xml'] ? strFromU8(files['ppt/theme/theme1.xml']) : undefined)

  // Ordine delle slide dai riferimenti della presentazione. Gli r:id vengono
  // letti dal DOM con fallback regex sull'XML grezzo (alcuni DOM non-browser
  // perdono gli attributi con prefisso di namespace).
  const presRels = relsOf(files, 'ppt/presentation.xml')
  const presRaw = strFromU8(presBytes)
  const rawSlideIds = Array.from(presRaw.matchAll(/<p:sldId[^>]*r:id="([^"]+)"/g)).map((m) => m[1])
  const domSlideIds = els(pres, 'p:sldId').map((el) => rAttr(el, 'id'))
  const slideIds = domSlideIds.every(Boolean) && domSlideIds.length ? (domSlideIds as string[]) : rawSlideIds
  const slidePaths: string[] = []
  for (const rid of slideIds) {
    const target = presRels.get(rid)
    if (target && files[target]) slidePaths.push(target)
  }

  const layoutCache = new Map<string, Map<string, { x: number; y: number; w: number; h: number }>>()
  const slides: PptxSlide[] = []

  for (const path of slidePaths) {
    const rawXml = strFromU8(files[path])
    const doc = parseXml(rawXml)
    if (!doc) {
      slides.push({ shapes: [] })
      continue
    }
    const rels = relsOf(files, path)
    // r:embed delle immagini in ordine di documento (fallback per i DOM che
    // perdono gli attributi namespaced: l'N-esimo p:pic usa l'N-esimo blip).
    const rawEmbeds = Array.from(rawXml.matchAll(/<a:blip[^>]*r:embed="([^"]+)"/g)).map((m) => m[1])

    // Layout della slide (per i placeholder senza posizione propria).
    let phMap: Map<string, { x: number; y: number; w: number; h: number }> | undefined
    for (const [, target] of rels) {
      if (target.includes('slideLayout')) {
        if (!layoutCache.has(target) && files[target]) {
          const ld = parseXml(strFromU8(files[target]))
          layoutCache.set(target, ld ? layoutPlaceholders(ld) : new Map())
        }
        phMap = layoutCache.get(target)
        break
      }
    }

    const slide: PptxSlide = { shapes: [] }

    // Sfondo pieno (slide, se c'è).
    const bg = first(doc, 'p:bg')
    if (bg) slide.bg = colorOf(first(bg, 'a:solidFill'), palette)

    // Forme di testo/riempimento.
    for (const sp of els(doc, 'p:sp')) {
      const spPr = first(sp, 'p:spPr')
      let box = boxOf(spPr)
      if (!box) {
        const ph = first(sp, 'p:ph')
        if (ph && phMap) {
          box =
            phMap.get(`${ph.getAttribute('type') ?? 'body'}:${ph.getAttribute('idx') ?? ''}`) ??
            phMap.get(`${ph.getAttribute('type') ?? 'body'}:`) ??
            null
        }
      }
      if (!box) continue // senza posizione non sappiamo dove metterla (v1)
      const shape: PptxShape = { ...box }
      const fill = spPr ? colorOf(first(spPr, 'a:solidFill'), palette) : undefined
      if (fill) shape.fill = fill
      shape.paras = parasOf(sp, palette)
      if (shape.paras || shape.fill) slide.shapes.push(shape)
    }

    // Immagini.
    els(doc, 'p:pic').forEach((pic, picIdx) => {
      const box = boxOf(first(pic, 'p:spPr'))
      if (!box) return
      const blip = first(pic, 'a:blip')
      const rid = (blip ? rAttr(blip, 'embed') : null) ?? rawEmbeds[picIdx]
      const target = rid ? rels.get(rid) : undefined
      const bytesImg = target ? files[target] : undefined
      if (!bytesImg) return
      const ext = (target!.split('.').pop() ?? 'png').toLowerCase()
      slide.shapes.push({ ...box, img: { bytes: bytesImg, ext } })
    })

    slides.push(slide)
  }

  return { w: Math.round(w), h: Math.round(h), slides }
}

// Testo grezzo del pptx (per ricerca globale e convertitore): niente DOM,
// basta una regex sugli <a:t> di ogni slide.
export function pptxText(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: (f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.name) })
  const names = Object.keys(files).sort((a, b) => {
    const n = (s: string) => Number(/slide(\d+)/.exec(s)?.[1] ?? 0)
    return n(a) - n(b)
  })
  const out: string[] = []
  for (const name of names) {
    const xml = strFromU8(files[name])
    const texts: string[] = []
    const re = /<a:t>([^<]*)<\/a:t>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(xml))) if (m[1]) texts.push(m[1])
    out.push(texts.join(' '))
  }
  return out.join('\n\n')
}
