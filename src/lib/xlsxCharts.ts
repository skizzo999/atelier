import { unzipSync, strFromU8 } from 'fflate'

// Lettura dei GRAFICI di un .xlsx. ExcelJS non li espone, ma il file li
// porta con sé: dentro lo zip ci sono il disegno (dove sta il grafico sul
// foglio) e il grafico vero e proprio, coi valori in cache (c:numCache).
// Teniamo ANCHE i riferimenti alle celle (c:f): così, quando l'utente
// modifica i dati, il grafico si aggiorna invece di restare quello salvato.
// Il grafico viene poi disegnato in SVG dalla griglia.

export interface ChartSeries {
  name: string
  values: number[]
  color?: string
  /** Riferimento delle celle dei valori (es. "Foglio1!$B$2:$B$4"). */
  valuesRef?: string
  /** Riferimento della cella col nome della serie. */
  nameRef?: string
}

export interface ChartInfo {
  sheet: number // indice del foglio, 0-based
  from: { col: number; row: number } // ancoraggio (0-based)
  to: { col: number; row: number }
  type: 'bar' | 'barH' | 'line' | 'pie' | 'area' | 'scatter'
  title: string
  categories: string[]
  series: ChartSeries[]
  /** Riferimento delle celle delle categorie. */
  categoriesRef?: string
}

/** Un riferimento "Foglio!$A$1:$B$9" scomposto (indici 1-based). */
export interface RefRange {
  sheet?: string
  r1: number
  c1: number
  r2: number
  c2: number
}

const colIndex = (letters: string): number => {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

// Scompone un riferimento di intervallo. Torna null se non lo riconosce
// (formule complesse, nomi definiti: in quel caso restano i valori in cache).
export function parseRef(ref: string): RefRange | null {
  // Il nome del foglio conta solo se seguito da '!': senza questo vincolo un
  // riferimento come "$C$5" verrebbe scambiato per un nome di foglio.
  const m = /^(?:(?:'([^']+)'|([^'!]+))!)?\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(ref.trim())
  if (!m) return null
  const sheet = m[1] ?? m[2]
  const c1 = colIndex(m[3])
  const r1 = Number(m[4])
  const c2 = m[5] ? colIndex(m[5]) : c1
  const r2 = m[6] ? Number(m[6]) : r1
  if (!Number.isFinite(r1) || !Number.isFinite(r2)) return null
  return {
    sheet: sheet || undefined,
    r1: Math.min(r1, r2),
    c1: Math.min(c1, c2),
    r2: Math.max(r1, r2),
    c2: Math.max(c1, c2),
  }
}

// --- helper DOM indipendenti dal prefisso di namespace ---
// Nome locale robusto: alcuni parser lasciano il prefisso dentro localName
// (verificato), quindi tagliamo sempre a mano quello che c'è prima dei ':'.
const localOf = (name: string): string => {
  const i = name.indexOf(':')
  return i < 0 ? name : name.slice(i + 1)
}
const kids = (root: Element | Document, local: string): Element[] => {
  const out: Element[] = []
  const all = root.getElementsByTagName('*')
  for (let i = 0; i < all.length; i++) {
    const el = all[i]
    if (localOf(el.localName || el.nodeName) === local) out.push(el)
  }
  return out
}
const first = (root: Element | Document, local: string): Element | null => kids(root, local)[0] ?? null
const attr = (el: Element | null, name: string): string | null => {
  if (!el) return null
  // getAttribute non è affidabile coi prefissi: cerchiamo anche per nome locale.
  const direct = el.getAttribute(name)
  if (direct !== null) return direct
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i]
    if (localOf(a.localName || a.name) === name) return a.value
  }
  return null
}

// Punti di una serie (categorie o valori): il file li tiene già calcolati,
// indicizzati; li rimettiamo in ordine.
function points(container: Element | null): string[] {
  if (!container) return []
  const out: string[] = []
  for (const pt of kids(container, 'pt')) {
    const idx = Number(attr(pt, 'idx') ?? out.length)
    const v = first(pt, 'v')?.textContent ?? ''
    out[idx] = v
  }
  return Array.from(out, (v) => v ?? '')
}

const CHART_TAGS: { tag: string; type: ChartInfo['type'] }[] = [
  { tag: 'barChart', type: 'bar' },
  { tag: 'bar3DChart', type: 'bar' },
  { tag: 'lineChart', type: 'line' },
  { tag: 'line3DChart', type: 'line' },
  { tag: 'pieChart', type: 'pie' },
  { tag: 'pie3DChart', type: 'pie' },
  { tag: 'doughnutChart', type: 'pie' },
  { tag: 'areaChart', type: 'area' },
  { tag: 'area3DChart', type: 'area' },
  { tag: 'scatterChart', type: 'scatter' },
]

// Percorso "../charts/chart1.xml" relativo a "xl/drawings/" → "xl/charts/chart1.xml"
function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = base.split('/').slice(0, -1)
  for (const p of target.split('/')) {
    if (p === '.' || p === '') continue
    if (p === '..') parts.pop()
    else parts.push(p)
  }
  return parts.join('/')
}

// Mappa rId → target di un file .rels
function rels(files: Record<string, Uint8Array>, relsPath: string, parser: DOMParser): Map<string, string> {
  const map = new Map<string, string>()
  const raw = files[relsPath]
  if (!raw) return map
  const doc = parser.parseFromString(strFromU8(raw), 'application/xml')
  for (const rel of kids(doc, 'Relationship')) {
    const id = attr(rel, 'Id')
    const target = attr(rel, 'Target')
    if (id && target) map.set(id, resolvePath(relsPath.replace('_rels/', '').replace(/\.rels$/, ''), target))
  }
  return map
}

// Legge tutti i grafici del file. Non lancia mai: un file senza grafici (o con
// un disegno che non capiamo) restituisce semplicemente meno elementi.
export function readCharts(bytes: Uint8Array): ChartInfo[] {
  const out: ChartInfo[] = []
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    return out
  }
  if (!files['xl/workbook.xml']) return out
  const parser = new DOMParser()

  // Ordine dei fogli nel workbook → percorso del loro XML.
  const wbDoc = parser.parseFromString(strFromU8(files['xl/workbook.xml']), 'application/xml')
  const wbRels = rels(files, 'xl/_rels/workbook.xml.rels', parser)
  const sheetPaths: string[] = []
  for (const sh of kids(wbDoc, 'sheet')) {
    const rid = attr(sh, 'id') // r:id
    const p = rid ? wbRels.get(rid) : null
    sheetPaths.push(p ?? '')
  }

  sheetPaths.forEach((sheetPath, sheetIndex) => {
    if (!sheetPath) return
    const sheetRels = rels(files, sheetPath.replace(/([^/]+)$/, '_rels/$1.rels'), parser)
    for (const drawingPath of sheetRels.values()) {
      if (!/drawings\/drawing\d+\.xml$/.test(drawingPath)) continue
      const drawRaw = files[drawingPath]
      if (!drawRaw) continue
      const drawDoc = parser.parseFromString(strFromU8(drawRaw), 'application/xml')
      const drawRels = rels(files, drawingPath.replace(/([^/]+)$/, '_rels/$1.rels'), parser)

      for (const anchor of [...kids(drawDoc, 'twoCellAnchor'), ...kids(drawDoc, 'oneCellAnchor')]) {
        const chartEl = kids(anchor, 'chart').find((e) => attr(e, 'id'))
        if (!chartEl) continue
        const chartPath = drawRels.get(attr(chartEl, 'id') ?? '')
        const chartRaw = chartPath ? files[chartPath] : undefined
        if (!chartRaw) continue

        const fromEl = first(anchor, 'from')
        const toEl = first(anchor, 'to')
        const num = (el: Element | null, tag: string, fallback: number) => {
          const v = el ? first(el, tag)?.textContent : null
          const n = v === null || v === undefined ? NaN : Number(v)
          return Number.isFinite(n) ? n : fallback
        }
        const fromCol = num(fromEl, 'col', 0)
        const fromRow = num(fromEl, 'row', 0)
        const info = parseChart(strFromU8(chartRaw), parser)
        if (!info) continue
        out.push({
          ...info,
          sheet: sheetIndex,
          from: { col: fromCol, row: fromRow },
          to: { col: num(toEl, 'col', fromCol + 8), row: num(toEl, 'row', fromRow + 15) },
        })
      }
    }
  })
  return out
}

// Contenuto di un chartN.xml → tipo, titolo, categorie, serie.
function parseChart(xml: string, parser: DOMParser): Omit<ChartInfo, 'sheet' | 'from' | 'to'> | null {
  const doc = parser.parseFromString(xml, 'application/xml')
  const plot = first(doc, 'plotArea')
  if (!plot) return null

  let type: ChartInfo['type'] | null = null
  let holder: Element | null = null
  for (const { tag, type: t } of CHART_TAGS) {
    const el = first(plot, tag)
    if (el) {
      holder = el
      type = t
      if (t === 'bar' && attr(first(el, 'barDir'), 'val') === 'bar') type = 'barH'
      break
    }
  }
  if (!holder || !type) return null

  const titleEl = first(doc, 'title')
  const title = titleEl
    ? kids(titleEl, 't')
        .map((t) => t.textContent ?? '')
        .join('')
        .trim()
    : ''

  let categories: string[] = []
  let categoriesRef: string | undefined
  const series: ChartSeries[] = []
  for (const ser of kids(holder, 'ser')) {
    const nameEl = first(ser, 'tx')
    const name =
      (nameEl ? points(first(nameEl, 'strCache'))[0] || first(nameEl, 'v')?.textContent : null) ??
      `Serie ${series.length + 1}`
    const catEl = first(ser, 'cat') ?? first(ser, 'xVal')
    const cats = catEl ? points(first(catEl, 'strCache') ?? first(catEl, 'numCache')) : []
    if (cats.length > categories.length) {
      categories = cats
      categoriesRef = (catEl ? first(catEl, 'f')?.textContent : null) ?? categoriesRef
    }
    const valEl = first(ser, 'val') ?? first(ser, 'yVal')
    const values = points(valEl ? first(valEl, 'numCache') : null).map((v) => {
      const n = Number(v)
      return Number.isFinite(n) ? n : 0
    })
    if (!values.length) continue
    const colorEl = first(ser, 'srgbClr')
    const color = colorEl ? `#${attr(colorEl, 'val')}` : undefined
    series.push({
      name: String(name),
      values,
      color,
      valuesRef: (valEl ? first(valEl, 'f')?.textContent : null) ?? undefined,
      nameRef: (nameEl ? first(nameEl, 'f')?.textContent : null) ?? undefined,
    })
  }
  if (!series.length) return null
  if (!categories.length) categories = series[0].values.map((_, i) => String(i + 1))
  return { type, title, categories, series, categoriesRef }
}
