import { unzipSync, strFromU8 } from 'fflate'
import { FORMATS, type DocLayout, type PageNumMode } from '../components/DocxEditor/DocSettings'

// Legge la "sezione" Word (sectPr) di un .docx creato FUORI da Atelier, così
// all'apertura ritroviamo formato/orientamento/margini/colore foglio e (best-effort)
// intestazioni e piè. Mammoth legge solo il corpo → questo copre la "cornice pagina".

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const TWIP_PER_PX = 15 // 96px = 1 pollice = 1440 twip
const TWIP_PER_CM = 1440 / 2.54 // 1 pollice = 2.54 cm

// Impostazioni ricavabili dal .docx (le altre restano ai default).
export type DocxImportSettings = Partial<DocLayout & { paper: string; footerLeft: string; pageNum: PageNumMode }>

// Attributo con prefisso `w:` (robusto rispetto al namespace).
function wAttr(el: Element, name: string): string | null {
  return el.getAttributeNS(W_NS, name) ?? el.getAttribute(`w:${name}`)
}
// Cerca per namespace (browser) con fallback al nome qualificato `w:` (i .docx
// usano sempre questo prefisso): robusto a implementazioni DOM diverse.
function wEls(root: Element | XMLDocument, local: string): Element[] {
  let els = Array.from(root.getElementsByTagNameNS(W_NS, local))
  if (!els.length) els = Array.from(root.getElementsByTagName(`w:${local}`))
  return els
}
function wFirst(root: Element | XMLDocument, local: string): Element | null {
  const els = wEls(root, local)
  return els.length ? els[0] : null
}

function parseXml(s: string): XMLDocument | null {
  try {
    const doc = new DOMParser().parseFromString(s, 'application/xml')
    if (doc.getElementsByTagName('parsererror').length) return null
    return doc
  } catch {
    return null
  }
}

// Dimensioni (twip) → formato foglio noto più vicino (i .docx custom sono rari).
function matchFormat(wTwip: number, hTwip: number): string {
  const portraitW = Math.min(wTwip, hTwip) / TWIP_PER_PX
  const portraitH = Math.max(wTwip, hTwip) / TWIP_PER_PX
  let best = 'A4'
  let bestDist = Infinity
  for (const [name, f] of Object.entries(FORMATS)) {
    const d = Math.abs(f.w - portraitW) + Math.abs(f.h - portraitH)
    if (d < bestDist) {
      bestDist = d
      best = name
    }
  }
  return best
}

const toCm = (twip: number) => Math.round((twip / TWIP_PER_CM) * 10) / 10

function hex6(c: string): string | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(c.trim())
  return m ? `#${m[1].toLowerCase()}` : null
}

// Testo di un'intestazione/piè: sinistra/destra (divise dal tab) + presenza dei
// campi numero pagina. Salta i codici campo e i risultati memorizzati.
interface HF {
  left: string
  right: string
  hasPage: boolean
  hasTotal: boolean
  hadTab: boolean
  ofWord: boolean // testo tipo "di"/"of" → formato esteso "Pagina X di Y"
}
function extractHF(doc: XMLDocument): HF {
  const res: HF = { left: '', right: '', hasPage: false, hasTotal: false, hadTab: false, ofWord: false }
  const root = doc.documentElement // w:hdr / w:ftr
  if (!root) return res
  let bucket: 'left' | 'right' = 'left'
  let fldDepth = 0 // dentro un campo complesso (fldChar begin…end)
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const local = child.localName
      // Proprietà di paragrafo/run: contengono formattazione (incl. le DEFINIZIONI
      // dei tab-stop <w:tabs><w:tab/>), non testo → saltale, altrimenti scambieremmo
      // il tab-stop col carattere tab vero (che sta dentro <w:r>).
      if (local === 'pPr' || local === 'rPr') continue
      if (local === 'fldSimple') {
        const instr = (wAttr(child, 'instr') || '').toUpperCase()
        if (/\bPAGE\b/.test(instr)) res.hasPage = true
        if (/\bNUMPAGES\b/.test(instr)) res.hasTotal = true
        continue // salta il risultato memorizzato del campo
      }
      if (local === 'fldChar') {
        const t = wAttr(child, 'fldCharType')
        if (t === 'begin') fldDepth++
        else if (t === 'end') fldDepth = Math.max(0, fldDepth - 1)
        continue
      }
      if (local === 'instrText') {
        const instr = (child.textContent || '').toUpperCase()
        if (/\bPAGE\b/.test(instr)) res.hasPage = true
        if (/\bNUMPAGES\b/.test(instr)) res.hasTotal = true
        continue
      }
      if (local === 'tab') {
        if (fldDepth === 0) {
          bucket = 'right'
          res.hadTab = true
        }
        continue
      }
      if (local === 't') {
        if (fldDepth === 0) res[bucket] += child.textContent || ''
        continue
      }
      walk(child)
    }
  }
  walk(root)
  res.ofWord = /\b(di|of)\b/.test(`${res.left} ${res.right}`.toLowerCase())
  return res
}

// Legge le impostazioni pagina dal .docx (Uint8Array del file). Null se non leggibile.
export function parseDocxSettings(bytes: Uint8Array): DocxImportSettings | null {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, {
      // Solo gli XML che servono: niente immagini (evita di decomprimere tutto).
      filter: (f) =>
        f.name === 'word/document.xml' ||
        f.name === 'word/_rels/document.xml.rels' ||
        /^word\/(header|footer)\d*\.xml$/.test(f.name),
    })
  } catch {
    return null
  }
  const docXml = files['word/document.xml']
  if (!docXml) return null
  const doc = parseXml(strFromU8(docXml))
  if (!doc) return null

  const out: DocxImportSettings = {}

  // sectPr principale = ultimo figlio diretto di w:body (setup pagina del documento).
  const body = wFirst(doc, 'body')
  let sectPr: Element | null = null
  if (body) {
    for (const child of Array.from(body.children)) {
      if (child.localName === 'sectPr') sectPr = child
    }
  }

  if (sectPr) {
    const pgSz = wFirst(sectPr, 'pgSz')
    if (pgSz) {
      const w = parseInt(wAttr(pgSz, 'w') || '', 10)
      const h = parseInt(wAttr(pgSz, 'h') || '', 10)
      const orient = (wAttr(pgSz, 'orient') || '').toLowerCase()
      if (w > 0 && h > 0) {
        out.format = matchFormat(w, h)
        out.landscape = orient === 'landscape' || (!orient && w > h)
      }
    }
    const pgMar = wFirst(sectPr, 'pgMar')
    if (pgMar) {
      const top = parseInt(wAttr(pgMar, 'top') || '', 10)
      const bottom = parseInt(wAttr(pgMar, 'bottom') || '', 10)
      const left = parseInt(wAttr(pgMar, 'left') || '', 10)
      const right = parseInt(wAttr(pgMar, 'right') || '', 10)
      if ([top, bottom, left, right].every((n) => Number.isFinite(n))) {
        out.margins = {
          top: toCm(Math.max(0, top)),
          bottom: toCm(Math.max(0, bottom)),
          left: toCm(Math.max(0, left)),
          right: toCm(Math.max(0, right)),
        }
      }
    }
  }

  // Colore foglio: <w:background w:color="RRGGBB"> (figlio di w:document).
  const bg = wFirst(doc, 'background')
  if (bg) {
    const color = wAttr(bg, 'color') || ''
    if (color && color.toLowerCase() !== 'auto') {
      const hx = hex6(color)
      if (hx) out.paper = hx
    }
  }

  // Intestazioni/piè (best-effort): risolvi i riferimenti "default" via le relazioni.
  try {
    const rels = files['word/_rels/document.xml.rels']
    if (rels && sectPr) {
      const relDoc = parseXml(strFromU8(rels))
      const idToTarget = new Map<string, string>()
      if (relDoc) {
        for (const rel of Array.from(relDoc.getElementsByTagName('Relationship'))) {
          const id = rel.getAttribute('Id')
          const target = rel.getAttribute('Target')
          if (id && target) idToTarget.set(id, target.replace(/^\//, ''))
        }
      }
      const pick = (refLocal: string): HF | null => {
        const refs = wEls(sectPr!, refLocal)
        const byType = (t: string) => refs.find((r) => (wAttr(r, 'type') || 'default') === t)
        const ref = byType('default') || byType('first') || refs[0]
        if (!ref) return null
        const rid = ref.getAttributeNS(R_NS, 'id') || ref.getAttribute('r:id')
        if (!rid) return null
        const target = idToTarget.get(rid)
        if (!target) return null
        const partName = target.startsWith('word/') ? target : `word/${target}`
        const partBytes = files[partName]
        if (!partBytes) return null
        const partDoc = parseXml(strFromU8(partBytes))
        return partDoc ? extractHF(partDoc) : null
      }

      const h = pick('headerReference')
      if (h) {
        if (h.left.trim()) out.headerLeft = h.left.trim()
        if (h.right.trim()) out.headerRight = h.right.trim()
        else if (h.hasPage) out.headerRight = '{page}'
      }
      const f = pick('footerReference')
      if (f) {
        if (f.hasPage) out.pageNum = f.hasTotal ? (f.ofWord ? 'page-of-total' : 'page-total') : 'page'
        // Testo libero a sinistra solo se davvero separato dal numero (c'era un tab),
        // altrimenti i frammenti "Pagina … di …" finirebbero come testo sporco.
        if (f.hadTab && f.left.trim()) out.footerLeft = f.left.trim()
        else if (!f.hasPage && f.left.trim()) out.footerLeft = f.left.trim()
      }
    }
  } catch {
    /* header/footer non leggibili: best-effort, si ignora */
  }

  return Object.keys(out).length ? out : null
}
